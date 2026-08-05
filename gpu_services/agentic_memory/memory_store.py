from __future__ import annotations

import asyncio
import os
from collections.abc import Iterable
from typing import Any

from mem0 import Memory

from schemas import Extraction


class MemoryStore:
    """Mem0-backed vector/BM25 memory with strict persona/source metadata."""

    def __init__(self) -> None:
        data_dir = os.environ.get(
            "AGENTIC_MEMORY_DATA_DIR", "/data/echodigitalpersona/runtime/agentic-memory"
        )
        qdrant_dir = os.path.join(data_dir, "qdrant")
        os.makedirs(qdrant_dir, exist_ok=True)
        config = {
            "vector_store": {
                "provider": "qdrant",
                "config": {
                    "collection_name": "echo_agentic_memory_v1",
                    "path": qdrant_dir,
                    "embedding_model_dims": 1024,
                    "on_disk": True,
                },
            },
            "embedder": {
                "provider": "huggingface",
                "config": {
                    "model": os.environ.get("MEMORY_EMBEDDING_MODEL", "BAAI/bge-m3"),
                    "embedding_dims": 1024,
                    "model_kwargs": {
                        "device": os.environ.get("MEMORY_EMBEDDING_DEVICE", "cuda")
                    },
                },
            },
            # Mem0 constructs this adapter even for infer=False. It is local
            # only and not invoked by this service's explicit extractor.
            "llm": {
                "provider": "openai",
                "config": {
                    "model": "Qwen3-4B-Instruct-2507",
                    "api_key": "local-only",
                    "openai_base_url": "http://127.0.0.1:9020/v1",
                },
            },
            "history_db_path": os.path.join(data_dir, "mem0-history.db"),
            "version": "v1.1",
        }
        self._memory = Memory.from_config(config)
        self._lock = asyncio.Lock()

    def _source_rows(self, persona_id: str, source_id: str) -> list[dict[str, Any]]:
        result = self._memory.get_all(
            filters={"user_id": persona_id, "source_id": source_id}, top_k=10_000
        )
        return list(result.get("results") or [])

    def _delete_source_sync(self, persona_id: str, source_id: str) -> int:
        rows = self._source_rows(persona_id, source_id)
        for row in rows:
            self._memory.delete(str(row["id"]))
        return len(rows)

    async def delete_source(self, persona_id: str, source_id: str) -> int:
        async with self._lock:
            return await asyncio.to_thread(self._delete_source_sync, persona_id, source_id)

    async def delete_persona(self, persona_id: str) -> None:
        async with self._lock:
            await asyncio.to_thread(self._memory.delete_all, user_id=persona_id)

    def _add_rows_sync(
        self,
        persona_id: str,
        source_id: str,
        source_type: str,
        role: str,
        created_at: str,
        raw_chunks: Iterable[tuple[str, str]],
        extraction: Extraction,
        original_name: str,
    ) -> int:
        self._delete_source_sync(persona_id, source_id)
        rows: list[tuple[str, dict[str, Any]]] = []
        for index, (chunk, chunk_source_type) in enumerate(raw_chunks):
            if chunk.strip():
                rows.append((chunk.strip(), {
                    "memory_kind": "raw", "chunk_index": index,
                    "source_type": chunk_source_type,
                }))
        for index, fact in enumerate(extraction.facts):
            rows.append((fact.text, {
                "memory_kind": "fact", "fact_index": index,
                "fact_type": fact.type, "confidence": fact.confidence,
            }))
        for index, phrase in enumerate(extraction.catchphrases):
            rows.append((phrase, {"memory_kind": "catchphrase", "style_index": index}))
        for index, term in enumerate(extraction.dialect_terms):
            value = term.term if not term.meaning else f"{term.term}: {term.meaning}"
            rows.append((value, {
                "memory_kind": "dialect_term", "style_index": index,
                "language": term.language or "",
            }))
        for text, extra in rows:
            metadata = {
                "source_id": source_id, "source_type": source_type,
                "role": role, "created_at": created_at,
                "original_name": original_name, **extra,
            }
            self._memory.add(text, user_id=persona_id, metadata=metadata, infer=False)
        return len(rows)

    async def replace_source(
        self,
        persona_id: str,
        source_id: str,
        source_type: str,
        role: str,
        created_at: str,
        raw_chunks: Iterable[tuple[str, str]],
        extraction: Extraction,
        original_name: str = "",
    ) -> int:
        chunks = list(raw_chunks)
        async with self._lock:
            return await asyncio.to_thread(
                self._add_rows_sync, persona_id, source_id, source_type, role,
                created_at, chunks, extraction, original_name,
            )

    def _search_sync(self, persona_id: str, query: str, top_k: int) -> list[dict[str, Any]]:
        result = self._memory.search(
            query, filters={"user_id": persona_id},
            top_k=min(max(top_k * 4, 12), 80), threshold=0.05, explain=True,
        )
        return list(result.get("results") or [])

    async def search(self, persona_id: str, query: str, top_k: int) -> list[dict[str, Any]]:
        async with self._lock:
            return await asyncio.to_thread(self._search_sync, persona_id, query, top_k)

    def _count_sync(self) -> int:
        result = self._memory.vector_store.client.count(
            collection_name=self._memory.collection_name, exact=True
        )
        return int(result.count)

    async def count(self) -> int:
        async with self._lock:
            return await asyncio.to_thread(self._count_sync)
