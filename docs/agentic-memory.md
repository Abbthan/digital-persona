# Agentic memory

ECHO's agentic-memory service is the backwards-compatible successor to the
legacy Chroma-only `persona-rag` service. It runs on the private GPU host, not
in Cloudflare, and retains the existing authenticated `/api/rag/*` contract.
The Worker therefore remains a lightweight gateway and existing chat,
document-ingestion and deletion callers do not need a second API.

## Data flow

```text
finalized chat turn / document text / media transcript
                         |
                         v
       local bilingual Qwen structured extraction
              |                         |
              v                         v
       Mem0 + Qdrant               Neo4j graph
       semantic memory       people, relations, timeline,
                             places, style, dialect, emotion
              |                         |
              +------------+------------+
                           v
                 bounded prompt context
                 + guided follow-up ideas
```

The always-on microphone already commits each finalized utterance as a normal
chat message. That same background ingestion path feeds memory; it does not
store a separate or unbounded audio transcript. Media affects semantic memory
only after the existing STT/OCR/captioning pipeline has produced text.

## Components and isolation

- `127.0.0.1:9010`: authenticated FastAPI memory contract.
- `127.0.0.1:9020`: pinned Qwen3-4B-Instruct-2507 extractor on GPU 3.
- embedded Qdrant through Mem0: bilingual BGE-M3 vectors on GPU 4.
- `127.0.0.1:7687`: Neo4j graph projection with HTTP disabled.
- `127.0.0.1:9000`: legacy Chroma service, retained temporarily for shadow
  writes and rollback.

Every vector row and graph node carries `persona_id` and `source_id`. The API
accepts only a valid HMAC system token whose `pid` exactly matches the persona
in the request. Retrieval, source deletion and persona deletion all apply the
same persona boundary. No model weights, secrets, graph/vector data or private
memory are committed to Git.

The extractor records supported facts, people/entities, relations, timeline
events, locations, recurring phrases and dialect terms, and stated emotional
attitudes in Chinese, English or mixed-language material. It also proposes
bounded follow-up questions for gaps that matter. Source text is treated as
untrusted data, sensitive attributes are not inferred, and transient comments
are not promoted to identity facts.

## Why Neo4j is separate from Mem0

Current Mem0 OSS manages the vector-memory lifecycle but no longer includes
the former graph-store integration. ECHO therefore uses Mem0 for Qdrant memory
and projects the same validated extraction into Neo4j. This preserves the
requested vector + graph design without pinning production to a removed Mem0
API.

## Rollout and rollback

1. Start and validate Neo4j, extractor and memory API independently.
2. Run synthetic persona-isolation, retrieval, prompt and deletion tests.
3. Migrate legacy Chroma source groups idempotently; do not delete Chroma.
4. Point the LiveTalking RAG proxy at port 9010 and keep shadow writes to 9000.
5. If the new API is unavailable, the proxy falls back to legacy Chroma for
   the request. Reverting `PERSONA_MEMORY_URL` to port 9000 is immediate.

Model/runtime pins and start commands are documented next to the service in
`gpu_services/agentic_memory/README.md`.

## Upstream references

- [Mem0 open-source repository](https://github.com/mem0ai/mem0)
- [Mem0 OSS overview](https://docs.mem0.ai/open-source/overview)
- [Mem0 OSS migration notes](https://docs.mem0.ai/migration/oss-v2-to-v3)
- [Neo4j Docker operations](https://neo4j.com/docs/operations-manual/current/docker/introduction/)
- [Qwen3-4B-Instruct-2507](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507)
