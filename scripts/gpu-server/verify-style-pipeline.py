#!/usr/bin/env python3
"""Synthetic source provenance/isolation test; no real biography or secrets printed."""
import json
import os
import sys
import uuid
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "gpu_services" / "agentic_memory"))
from media_jobs import system_token


def main():
    persona = "style-test-" + uuid.uuid4().hex
    other = "style-other-" + uuid.uuid4().hex
    base = "http://127.0.0.1:9010"
    headers = {"Authorization": "Bearer " + system_token(persona)}
    def post(path, body):
        response = requests.post(base + path, headers=headers, json=body, timeout=90)
        response.raise_for_status()
        return response.json()
    try:
        for source_id, role, attribution, content in [
            ("generated", "persona", "target", "Generated-only-markerZQ9 is my favourite phrase."),
            ("en", "source", "target", "Honestly, I tend to keep things pretty simple. I mean, why overcomplicate it?"),
            ("zh", "source", "target", "其实我觉得这样蛮好的。要不我们先试试看？"),
            ("unknown", "source", "unknown", "Unverified-only-markerYQ8 is a very specific wording."),
        ]:
            post("/api/rag/ingest/conversation", {"persona_id":persona,"message_id":source_id,"role":role,"target_authorship":attribution,"content":content,"extract_memories":False})
        result = post("/api/rag/compose-prompt", {"persona_id":persona,"persona_name":"Synthetic","query":"What do you think?","purpose":"style"})
        assert "Honestly" in result["prompt"] and "其实" in result["prompt"]
        assert "Generated-only-markerZQ9" not in result["prompt"] and "Unverified-only-markerYQ8" not in result["prompt"]
        forbidden = requests.post(base + "/api/rag/compose-prompt", headers=headers, json={"persona_id":other,"persona_name":"Other","query":"hello","purpose":"style"}, timeout=20)
        assert forbidden.status_code == 403
        assert requests.get(base+f"/api/rag/style-profile/{persona}",timeout=10).status_code == 401
        post("/api/rag/style-attribution", {"persona_id":persona,"source_id":"en","target_authorship":"unknown"})
        revoked = post("/api/rag/compose-prompt", {"persona_id":persona,"persona_name":"Synthetic","query":"hello","purpose":"style"})
        assert "Honestly" not in revoked["prompt"]
        print(json.dumps({"ok":True,"source_only":True,"bilingual":True,"cross_persona_blocked":True,"revocation":True}))
    finally:
        response = requests.delete(base+f"/api/rag/persona/{persona}", headers=headers, timeout=90)
        response.raise_for_status()


if __name__ == "__main__":
    main()
