"""Idempotently migrate legacy Chroma rows without logging private content."""

from __future__ import annotations

import argparse
import asyncio
import os
from collections import defaultdict
from typing import Any

import chromadb

from extraction_client import ExtractionClient
from graph_store import GraphStore
from memory_store import MemoryStore


def groups(chroma_path: str) -> list[dict[str, Any]]:
    client = chromadb.PersistentClient(path=chroma_path)
    collection = client.get_collection("persona_memory")
    result = collection.get(include=["documents", "metadatas"])
    grouped: dict[tuple[str, str], dict[str, Any]] = defaultdict(
        lambda: {"chunks": [], "role": "source", "created_at": "", "original_name": ""}
    )
    for text, metadata in zip(result.get("documents") or [], result.get("metadatas") or []):
        metadata = metadata or {}
        persona_id = str(metadata.get("persona_id") or "")
        source_id = str(metadata.get("asset_id") or metadata.get("message_id") or "")
        if not persona_id or not source_id or not text:
            continue
        row = grouped[(persona_id, source_id)]
        row.update({
            "persona_id": persona_id,
            "source_id": source_id,
            "source_type": str(metadata.get("source_type") or "document"),
            "role": str(metadata.get("role") or row["role"]),
            "created_at": str(metadata.get("created_at") or row["created_at"]),
            "original_name": str(metadata.get("original_name") or row["original_name"]),
        })
        row["chunks"].append((str(text), str(metadata.get("source_type") or "document")))
    return list(grouped.values())


async def migrate(chroma_path: str, limit: int | None, dry_run: bool) -> None:
    rows = groups(chroma_path)
    if limit is not None:
        rows = rows[:limit]
    print(f"legacy_source_groups={len(rows)} dry_run={str(dry_run).lower()}")
    if dry_run:
        return
    memory, graph, extractor = MemoryStore(), GraphStore(), ExtractionClient()
    graph.verify()
    migrated = 0
    for row in rows:
        source_text = "\n\n".join(text for text, _ in row["chunks"])
        extraction = await extractor.extract(source_text, row["role"], row["source_type"])
        await memory.replace_source(
            row["persona_id"], row["source_id"], row["source_type"], row["role"],
            row["created_at"], row["chunks"], extraction, row["original_name"],
        )
        await asyncio.to_thread(
            graph.replace_source, row["persona_id"], row["source_id"], row["source_type"],
            row["role"], row["created_at"], source_text, extraction,
        )
        migrated += 1
        print(f"migrated_groups={migrated}/{len(rows)}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--chroma-path",
        default=os.environ.get(
            "LEGACY_CHROMA_PATH", "/data/echodigitalpersona/persona-rag/data/chroma"
        ),
    )
    parser.add_argument("--limit", type=int)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    asyncio.run(migrate(args.chroma_path, args.limit, args.dry_run))


if __name__ == "__main__":
    main()
