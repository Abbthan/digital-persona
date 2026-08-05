"""Synthetic API smoke test. Never reads or prints real persona content."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
import uuid

import httpx


def token(persona_id: str) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({
        "uid": "system", "pid": persona_id, "exp": time.time() + 300,
    }).encode()).rstrip(b"=").decode()
    signature = hmac.new(
        os.environ["LIVETALKING_SESSION_SECRET"].encode(),
        payload.encode(), hashlib.sha256,
    ).digest()
    return payload + "." + base64.urlsafe_b64encode(signature).rstrip(b"=").decode()


def texts(body: dict) -> list[str]:
    return [
        str(hit.get("text", ""))
        for category in ("conversation", "documents", "document_images", "facts", "style")
        for hit in body.get(category, [])
    ]


def main() -> None:
    base = os.environ.get("AGENTIC_MEMORY_TEST_URL", "http://127.0.0.1:9010")
    suffix = uuid.uuid4().hex
    persona_a, persona_b = f"synthetic-a-{suffix}", f"synthetic-b-{suffix}"
    source_id, marker = f"source-{suffix}", f"synthetic-marker-{suffix}"
    headers_a = {"Authorization": "Bearer " + token(persona_a)}
    headers_b = {"Authorization": "Bearer " + token(persona_b)}
    with httpx.Client(timeout=180) as client:
        before = client.get(base + "/health").json()
        try:
            added = client.post(base + "/api/rag/ingest/conversation", headers=headers_a, json={
                "persona_id": persona_a, "message_id": source_id, "role": "user",
                "content": f"I remember {marker} from Shanghai in 2026.",
                "created_at": "2026-08-05T00:00:00Z",
            })
            assert added.status_code == 200, added.text[:300]
            crossed = client.post(base + "/api/rag/ingest/conversation", headers=headers_a, json={
                "persona_id": persona_b, "message_id": "crossed", "role": "user",
                "content": "must be rejected",
            })
            assert crossed.status_code == 403
            own = client.post(base + "/api/rag/retrieve", headers=headers_a, json={
                "persona_id": persona_a, "query": marker, "top_k": 8,
            })
            other = client.post(base + "/api/rag/retrieve", headers=headers_b, json={
                "persona_id": persona_b, "query": marker, "top_k": 8,
            })
            assert own.status_code == 200 and any(marker in value for value in texts(own.json()))
            assert other.status_code == 200 and not any(marker in value for value in texts(other.json()))
            composed = client.post(base + "/api/rag/compose-prompt", headers=headers_a, json={
                "persona_id": persona_a, "persona_name": "Synthetic Persona",
                "query": marker, "top_k": 8,
            })
            assert composed.status_code == 200 and marker in composed.json().get("prompt", "")
            deleted = client.delete(
                f"{base}/api/rag/source/{persona_a}/{source_id}", headers=headers_a
            )
            assert deleted.status_code == 200
            gone = client.post(base + "/api/rag/retrieve", headers=headers_a, json={
                "persona_id": persona_a, "query": marker, "top_k": 8,
            })
            assert gone.status_code == 200 and not any(marker in value for value in texts(gone.json()))
        finally:
            client.delete(f"{base}/api/rag/persona/{persona_a}", headers=headers_a)
            client.delete(f"{base}/api/rag/persona/{persona_b}", headers=headers_b)
        after = client.get(base + "/health").json()
    assert after["vector_count"] == before["vector_count"]
    assert after["graph_memory_count"] == before["graph_memory_count"]
    print("SYNTHETIC_ISOLATION_RETRIEVAL_DELETE_PASS")


if __name__ == "__main__":
    main()
