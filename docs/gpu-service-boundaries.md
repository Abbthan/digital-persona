# GPU service boundaries

The Cloudflare Worker is an authenticated, lightweight application gateway.
It must never run model inference, store model weights, hold Chroma files, or
buffer large media. GPU work belongs to independently deployable services on
the GPU host.

## Boundaries

| Module | Responsibility | Must not own | Runtime data |
| --- | --- | --- | --- |
| LiveTalking | WebRTC signalling/media and avatar inference | TTS implementation, STT implementation, vector storage | persona avatar packages only |
| FastWhisper STT | audio/video transcription and language detection | avatar generation, TTS, memory writes | disposable job files and transcript results |
| CozyVoice TTS | prepared-reference voice synthesis | WebRTC, source-file ownership, memory retrieval | voice-reference cache only |
| agentic-memory | bilingual extraction, Mem0 retrieval, graph projection and prompt-context assembly | LLM reply calls, TTS, avatar inference | Qdrant and Neo4j only |
| legacy persona-RAG | temporary shadow-write and rollback path | new graph memory | Chroma database only |
| memory data | persisted vectors and graph | application code or model weights | dedicated Qdrant, Neo4j and rollback Chroma directories |
| models | downloaded/checkpoint weights | mutable application state or persona-private records | read-only shared model cache only |

Each service has its own virtual environment/container, health endpoint,
restart policy, structured logs, and resource assignment. A failure or restart
of CozyVoice must not restart LiveTalking; a memory rebuild must not alter
model files; FastWhisper jobs must use a disposable work directory.

## Repository and application adapters

The Cloudflare/Next.js source keeps provider-specific access behind narrow
server-only adapters:

```text
back_end/services/live-avatar.ts  -> WebRTC, avatar training, TURN contracts
back_end/services/speech.ts       -> STT, TTS dispatch, voice-reference contracts
back_end/services/persona-rag.ts  -> persona-scoped retrieval contracts
back_end/services/persona-ai.ts   -> LLM prompt/reply orchestration only
```

Existing runtime calls still use the authenticated LiveTalking gateway, so
this refactor does not change public APIs, HMAC secrets, persona records, or
the current production service. New work must import the narrow adapter,
not `livetalking.ts` directly. `livetalking.ts` is retained as a legacy
transport implementation until the GPU service source is checked into its own
repository subdirectories.

## Target GPU host layout

The service source and its runtime state must stay separate. Do **not** add
the data directories below to Git.

```text
/data/echodigitalpersona/
  services/
    livetalking/           # code + environment for avatar/WebRTC service
    fastwhisper/           # code + environment for STT worker/API
    cosyvoice/             # code + environment for TTS API
    agentic-memory/        # Mem0/Qdrant + graph retrieval API
    persona-rag/           # legacy rollback service during rollout
  runtime/
    avatars/               # persona packages; private, not Git
    voice-references/      # private, not Git
    agentic-memory/        # private Qdrant + Neo4j data, not Git
    chroma/                # legacy rollback vector data, not Git
    jobs/                  # disposable files, not Git
  models/                  # read-only model/cache mount, not Git
```

Use separate service users/containers where the host permits it. The only
cross-service traffic should be authenticated HTTP/RPC contracts; no service
should read another service's virtual environment or mutable data directory.

## Rollout rules

1. Back up the specific runtime data volume before changing its owning service.
2. Deploy and health-check one service at a time.
3. Keep API contracts versioned and backwards compatible while Worker code is
   being rolled out.
4. Switch a gateway URL only after external HTTPS/WebRTC verification; retain
   the old host as rollback until real browser testing passes.
5. Commit GPU service source/config templates to GitHub, but never persona
   media, voice references, Chroma data, model weights, `.env`, or SSH keys.
