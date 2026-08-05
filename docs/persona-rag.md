# Persona RAG (legacy rollback service)

> Production migration is moving this Chroma-only implementation to the
> vector + graph architecture in [agentic-memory.md](agentic-memory.md). The
> API contract remains compatible; Chroma stays online for shadow writes and
> rollback until the new service is proven stable.

A standalone FastAPI service on the same GPU box as LiveTalking/CosyVoice —
`persona-rag` — gives each persona a real vector-store memory: it ingests
past conversations and uploaded documents (including OCR of images embedded
in those documents), and can retrieve the most relevant ones for a query and
assemble them into a ready-to-use prompt. The RAG service itself never calls
an LLM; `back_end/services/persona-ai.ts` consumes its bounded output through
a server-only LLM call. This keeps extraction and embeddings off the
Cloudflare Worker while grounding each reply in private persona memory.

## Why a separate service

Same reasoning as LiveTalking/CosyVoice: embedding models and a vector store
are too heavy for a Cloudflare Worker, so they run on the GPU box and this
app talks to them over HTTP. `persona-rag` has its own venv (FastAPI +
chromadb + sentence-transformers + PyMuPDF + python-docx + pytesseract) —
kept separate from LiveTalking's and CosyVoice's venvs to avoid any risk of
destabilizing those already-working, already-debugged environments.

## Architecture

```
Upload a document (type="text") ──▶ POST /api/personas/[id]/assets
                                            │
                                   ingestDocument() (persona-rag.ts)
                                            │
                                            ▼
                        POST {LT}/api/rag/ingest/document ──▶ persona-rag service
                                                                (extract text + OCR images,
                                                                 chunk, embed, upsert to Chroma)

Send a chat message ──▶ POST /api/personas/[id]/messages
                                │
                       ingestConversationMessage() (persona-rag.ts, both real turns)
                                │
                                ▼
            POST {LT}/api/rag/ingest/conversation ──▶ persona-rag service

Delete a document/message ──▶ deleteRagSource() ──▶ DELETE {LT}/api/rag/source/{persona}/{id}
Delete a persona           ──▶ deleteAllRagData() ──▶ DELETE {LT}/api/rag/persona/{persona}

composePersonaPrompt(personaId, personaName, query) ──▶ POST {LT}/api/rag/compose-prompt
    → retrieves top-k chunks per source type, assembles a system+context+query prompt string,
      returns it to persona-ai.ts, which calls the configured server-only LLM
```

`{LT}` = `LIVETALKING_SERVER_URL`, same as the avatar/voice integration —
`persona-rag` binds to `127.0.0.1:9000` only, reached through a generic
reverse proxy (`rag_proxy` in LiveTalking's `app.py`) at `{LT}/api/rag/*` so
it doesn't need its own external port. Same HMAC bearer-token auth as
everything else on the box (`back_end/services/livetalking.ts`'s
`createLiveSessionToken`, reused as-is by `persona-rag.ts`).

## Embedding model

`BAAI/bge-m3` via `sentence-transformers` — chosen specifically because it's
genuinely strong at **both Chinese and English in the same vector space**,
which matters since a persona's documents/conversations can be either
language, or switch mid-document. Verified with a real cross-lingual test:
an English query ("Did you ever have a pet growing up?") correctly ranked a
Chinese-language memory about a childhood cat above two unrelated English
facts (distance 0.386 vs. 0.584/0.687) — genuine semantic matching, not
keyword search.

Runs on **CPU, not GPU** — the fresh venv pulled a newer PyTorch than this
box's NVIDIA driver's CUDA version supports, so `torch.cuda.is_available()`
is `False` and `store.py` falls back to CPU automatically. Still correct,
just slower than GPU; not urgent since ingestion is off the chat-response
critical path. Same class of fix as already applied to LiveTalking/CosyVoice
if it's ever worth doing: pin an older torch build matching the driver.

## Vector store

[Chroma](https://www.trychroma.com/), persisted to disk
(`persona-rag/data/chroma/`), one collection (`persona_memory`) with
`persona_id`/`source_type`/`asset_id`/`message_id` metadata on every chunk
rather than one collection per persona — simpler to manage, and retrieval
always filters by `persona_id` anyway.

`source_type` is one of `document` (native text extracted from an uploaded
PDF/DOCX/TXT or compacted social-profile note), `document_image` (OCR text
from an image embedded in that document), or `conversation` (a chat message).
Retrieval and prompt composition report these separately so the LLM can tell
what kind of memory it is looking at.

### Real selective deletion — unlike the avatar/voice models

MuseTalk and CosyVoice have no way to "forget" one source without a full
retrain from whatever's left (see `docs/livetalking-integration.md`).
Chroma doesn't have that limitation: `DELETE /api/rag/source/{persona}/{id}`
does an exact metadata-filtered delete. Verified directly: ingested three
facts, confirmed a query correctly ranked the right one first, deleted it,
re-queried, and confirmed it was gone while the other two remained.

## Document ingestion (`ingest.py`)

- **PDF** (PyMuPDF/`fitz`): per page, extracts the native text layer. If a
  page has substantial native text, any embedded raster images on that page
  are extracted and OCR'd individually (a normal text page with a few inset
  photos). If a page has almost no native text (a scanned page, or a page
  that's just one full-page image), the whole page is rendered at 200 DPI
  and OCR'd once instead — avoids OCRing the same image twice.
- **DOCX** (`python-docx`): paragraph text directly; embedded images (via
  `document.part.rels`) are OCR'd individually.
- **TXT**: read directly, no images possible.
- **OCR** (`pytesseract`, `lang="chi_sim+eng"`): one pass handles Chinese,
  English, or a mix on the same page/image, matching this project's
  bilingual requirement without per-file language detection.
- **Chunking**: simple paragraph-aware splitter, ~800 chars with 100-char
  overlap on paragraphs longer than that — no tokenizer dependency, works
  the same for CJK (character-dense) and English (word-dense) text.

Verified with real generated PDF and DOCX files (not the plain-text-only
path) — native text, an embedded image inside a PDF (both the
per-image-OCR and whole-page-OCR branches), and an embedded image inside a
DOCX all came back correctly through the full app (real upload →
`/api/personas/[id]/assets` → ingestion → retrieval), including a case
where the OCR result was genuinely garbled (a low-quality synthetic test
image) — confirmed that's an OCR-accuracy limit on that specific image, not
a pipeline bug, since the same pipeline reads real document images cleanly.

## Conversation ingestion

Both the **user's** and the real persona side of a chat are ingested after a
successful response. Ingestion is deliberately background work: the current
turn is included directly in the LLM request, so a temporary RAG outage does
not block chat, while later turns can still retrieve either side of the
conversation.

## Boundaries

- The configured LLM receives only a capped set of retrieved text excerpts,
  recent conversation turns, and the current message. It never receives R2
  URLs, raw files, another persona's records, or the API key.
- Uploaded documents and compacted public social-profile notes are indexed.
  Photos, videos, and audio currently feed the avatar/voice pipelines; only
  text that has actually been extracted or transcribed can influence the
  language-model context. The selected CosyVoice reference's existing
  FastWhisper transcript is also supplied as a bounded, untrusted persona
  reference on each response. This avoids claiming that uncaptioned pixels
  or audio were understood when they have not been.
- This is retrieval-grounded prompting, not a base-model fine-tune. It gives
  the persona continuity without mixing one account's information into
  another account's model state.

## Running it

```
cd ~/ethan/persona-rag
source .venv/bin/activate
LIVETALKING_SESSION_SECRET=$(grep LIVETALKING_SESSION_SECRET ~/ethan/LiveTalking/.env | cut -d= -f2) \
  uvicorn main:app --host 127.0.0.1 --port 9000
```

Runs in the `persona-rag` tmux session (survives SSH disconnects, same
pattern as `livetalking-server`/`cosyvoice-server`). Restart LiveTalking's
own server after changing `app.py`'s proxy routes; restarting `persona-rag`
alone is enough for changes to `main.py`/`store.py`/`ingest.py`/`prompts.py`.
