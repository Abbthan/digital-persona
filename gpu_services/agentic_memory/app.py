from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile

import ingest
import prompts
from auth import SessionClaims, require_matching_persona, require_system_claims
from extraction_client import ExtractionClient
from graph_store import GraphStore
from memory_store import MemoryStore
from schemas import (
    ComposePromptRequest, ConversationIngestRequest, RetrieveRequest,
    SourceDocumentIngestRequest,
)

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger("agentic-memory")
memory_store: MemoryStore | None = None
graph_store: GraphStore | None = None
extractor = ExtractionClient()


@asynccontextmanager
async def lifespan(_: FastAPI):
    global memory_store, graph_store
    memory_store = await asyncio.to_thread(MemoryStore)
    graph_store = await asyncio.to_thread(GraphStore)
    await asyncio.to_thread(graph_store.verify)
    yield
    await asyncio.to_thread(graph_store.driver.close)


app = FastAPI(title="ECHO Agentic Memory", version="1.0.0", lifespan=lifespan)


def stores() -> tuple[MemoryStore, GraphStore]:
    if memory_store is None or graph_store is None:
        raise HTTPException(status_code=503, detail="memory service is warming")
    return memory_store, graph_store


@app.get("/health")
async def health() -> dict[str, Any]:
    vector, graph = stores()
    vector_count, graph_count = await asyncio.gather(
        vector.count(), asyncio.to_thread(graph.count)
    )
    return {
        "ok": True, "service": "agentic-memory", "mem0": True,
        "vector_count": vector_count, "graph_memory_count": graph_count,
        "extractor_url": extractor.url,
    }


def _private_media_url(source_url: str) -> None:
    parsed = urlparse(source_url)
    if (parsed.scheme != "https"
            or parsed.netloc not in {"echodigitalpersona.com", "www.echodigitalpersona.com"}
            or not parsed.path.startswith("/api/internal/persona-media/")):
        raise HTTPException(status_code=400, detail="invalid private media source")


async def _replace(persona_id: str, source_id: str, source_type: str, role: str,
                   created_at: str, chunks: list[tuple[str, str]],
                   original_name: str = "") -> int:
    vector, graph = stores()
    source_text = "\n\n".join(text for text, _ in chunks)
    extraction = await extractor.extract(source_text, role, source_type)
    count = await vector.replace_source(
        persona_id, source_id, source_type, role, created_at,
        chunks, extraction, original_name,
    )
    try:
        await asyncio.to_thread(
            graph.replace_source, persona_id, source_id, source_type,
            role, created_at, source_text, extraction,
        )
    except Exception:
        logger.exception("graph projection failed persona=%s source=%s", persona_id, source_id)
    return count


@app.post("/api/rag/ingest/conversation")
async def ingest_conversation(
    body: ConversationIngestRequest,
    claims: SessionClaims = Depends(require_system_claims),
) -> dict[str, Any]:
    require_matching_persona(claims, body.persona_id)
    chunks = [
        (chunk, "conversation") for chunk in ingest.chunk_text(body.content)
    ] if body.content.strip() else []
    if not chunks:
        return {"ok": True, "chunks": 0}
    count = await _replace(
        body.persona_id, body.message_id, "conversation", body.role,
        body.created_at or datetime.now(UTC).isoformat(), chunks,
    )
    return {"ok": True, "chunks": len(chunks), "memories": count}


def _document_chunks(extracted: ingest.ExtractedDoc) -> list[tuple[str, str]]:
    return [
        *((chunk, "document") for chunk in extracted.text_chunks),
        *((chunk, "document_image") for chunk in extracted.image_ocr_chunks),
    ]


@app.post("/api/rag/ingest/document")
async def ingest_document(
    persona_id: str = Form(...), asset_id: str = Form(...),
    file: UploadFile = File(...),
    claims: SessionClaims = Depends(require_system_claims),
) -> dict[str, Any]:
    require_matching_persona(claims, persona_id)
    try:
        extracted = ingest.extract_document(file.filename or "document", await file.read())
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        logger.exception("document extraction failed asset=%s", asset_id)
        raise HTTPException(status_code=422, detail="couldn't read that document") from error
    await _replace(
        persona_id, asset_id, "document", "source", datetime.now(UTC).isoformat(),
        _document_chunks(extracted), file.filename or "",
    )
    return {"ok": True, "text_chunks": len(extracted.text_chunks),
            "image_ocr_chunks": len(extracted.image_ocr_chunks)}


@app.post("/api/rag/ingest/document-from-url")
async def ingest_document_from_url(
    body: SourceDocumentIngestRequest,
    authorization: str | None = Header(default=None),
    claims: SessionClaims = Depends(require_system_claims),
) -> dict[str, Any]:
    require_matching_persona(claims, body.persona_id)
    _private_media_url(body.source_url)
    try:
        async with httpx.AsyncClient(timeout=180, follow_redirects=False) as client:
            response = await client.get(
                body.source_url,
                headers={"Authorization": authorization} if authorization else {},
            )
        if response.status_code != 200:
            raise HTTPException(status_code=502, detail="couldn't retrieve private document")
        extracted = ingest.extract_document(body.file_name, response.content)
    except HTTPException:
        raise
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        logger.exception("document source extraction failed asset=%s", body.asset_id)
        raise HTTPException(status_code=422, detail="couldn't read that document") from error
    await _replace(
        body.persona_id, body.asset_id, "document", "source",
        datetime.now(UTC).isoformat(), _document_chunks(extracted), body.file_name,
    )
    return {"ok": True, "text_chunks": len(extracted.text_chunks),
            "image_ocr_chunks": len(extracted.image_ocr_chunks)}


def _hit(row: dict[str, Any]) -> dict[str, Any]:
    score = float(row.get("score") or 0)
    return {"text": str(row.get("memory") or ""),
            "distance": max(0.0, min(2.0, 1.0 - score)),
            "metadata": row.get("metadata") or {}}


async def _retrieve(persona_id: str, query: str, top_k: int) -> dict[str, Any]:
    vector, graph = stores()
    rows, graph_context = await asyncio.gather(
        vector.search(persona_id, query, top_k),
        asyncio.to_thread(graph.context, persona_id, query, top_k),
    )
    categories: dict[str, list[dict[str, Any]]] = {
        "conversation": [], "documents": [], "document_images": [],
        "facts": [], "style": [],
    }
    for row in rows:
        metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        kind, source_type = str(metadata.get("memory_kind", "raw")), str(metadata.get("source_type", ""))
        target = ("style" if kind in {"catchphrase", "dialect_term"} else
                  "facts" if kind == "fact" else
                  "conversation" if source_type == "conversation" else
                  "document_images" if source_type == "document_image" else
                  "documents" if source_type == "document" else "facts")
        categories[target].append(_hit(row))
    for key in categories:
        categories[key] = categories[key][:top_k]
    return {**categories, "graph": graph_context}


@app.post("/api/rag/retrieve")
async def retrieve(body: RetrieveRequest,
                   claims: SessionClaims = Depends(require_system_claims)) -> dict[str, Any]:
    require_matching_persona(claims, body.persona_id)
    return {"ok": True, **await _retrieve(body.persona_id, body.query, body.top_k)}


@app.post("/api/rag/compose-prompt")
async def compose_prompt(body: ComposePromptRequest,
                         claims: SessionClaims = Depends(require_system_claims)) -> dict[str, Any]:
    require_matching_persona(claims, body.persona_id)
    result = await _retrieve(body.persona_id, body.query, body.top_k)
    text = prompts.compose_prompt(
        body.persona_name, body.query, result["conversation"], result["documents"],
        result["document_images"], result["facts"], result["style"], result["graph"],
    )
    return {"ok": True, "prompt": text, "sources": {
        "conversation": result["conversation"], "documents": result["documents"],
        "document_images": result["document_images"],
    }}


@app.delete("/api/rag/source/{persona_id}/{source_id}")
async def delete_source(persona_id: str, source_id: str,
                        claims: SessionClaims = Depends(require_system_claims)) -> dict[str, bool]:
    require_matching_persona(claims, persona_id)
    vector, graph = stores()
    await asyncio.gather(vector.delete_source(persona_id, source_id),
                         asyncio.to_thread(graph.delete_source, persona_id, source_id))
    return {"ok": True}


@app.delete("/api/rag/persona/{persona_id}")
async def delete_persona(persona_id: str,
                         claims: SessionClaims = Depends(require_system_claims)) -> dict[str, bool]:
    require_matching_persona(claims, persona_id)
    vector, graph = stores()
    await asyncio.gather(vector.delete_persona(persona_id),
                         asyncio.to_thread(graph.delete_persona, persona_id))
    return {"ok": True}
