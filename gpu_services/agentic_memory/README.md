# ECHO Agentic Memory

Backwards-compatible successor to `persona-rag`:

- current Mem0 OSS manages persistent vector/BM25 memory in embedded Qdrant;
- local Qwen3 extracts bilingual facts, entities, relations, timelines,
  locations, catchphrases/dialect, emotions and follow-up questions;
- Neo4j stores the graph projection separately because current Mem0 OSS has
  removed the former built-in graph-store integration;
- every record and deletion is persona-scoped; gateway tokens must have
  `uid=system` and a matching `pid`;
- the existing Chroma service on port 9000 stays online as rollback during
  shadow rollout.

Localhost-only ports: memory API `9010`, extractor `9020`, Neo4j Bolt `7687`.
Never commit model weights, private memory, graph/vector data or secrets.

The extractor is pinned to Qwen3-4B-Instruct-2507 revision
`cdbee75f17c01a7cc42f958dc650907174af0554`. Production starts from the
verified local snapshot under `${ECHO_GPU_ROOT}/models`; network access is
disabled at runtime.

`requirements.txt` reproduces the memory API/migration environment and
`requirements-extractor.txt` records the tested CUDA extractor stack. The
current host launches the extractor with the already-validated LiveTalking
CUDA environment to avoid duplicating 6.1 GB while `/data` is 97% utilized;
the extractor remains a separate process, GPU assignment and tmux service.

Standalone JPG, JPEG and PNG persona uploads are OCR'd as bilingual source
documents. `pytesseract` is only the Python adapter, so every new GPU host
must also install the system engine and language packs before starting this
service:

```sh
apt-get install tesseract-ocr tesseract-ocr-eng tesseract-ocr-chi-sim
```

PDF and DOCX embedded-image OCR uses the same `chi_sim+eng` configuration.
If these packages are absent, native document text still works but image OCR
will correctly return no chunks rather than inventing content.

The existing always-on microphone path already converts a finalized utterance
into a normal chat message. Its background message ingestion feeds this service
without creating a separate voice-message workflow. Graph-backed follow-up
questions are inserted into the bounded prompt used by the existing initiative
logic.

## Source-only style and full-recording ingestion (1 November 2026)

The deployed 3090 launchers are in `scripts/gpu-server/memory-3090/`: CPU
embeddings/extraction in an isolated environment, private local graph/data,
and localhost endpoints. The older A800/tmux/disk assumptions above are
historical, not instructions to move the current services back there.

Style has its own `style-evidence.sqlite3`, not an unfiltered semantic query
over prior generated replies. `purpose=style` on compose-prompt uses only
owner-confirmed target speech/writing. Unverified/mixed material and scripted
readings do not establish spontaneous habits. English and Chinese statistics,
original examples and limited-evidence indicators remain separate. Generated
replies stay raw conversation continuity but cannot add new inferred style or
biographical facts; legacy generated style/facts are filtered on retrieval.

`POST /api/rag/ingest/media-from-url` persists a job and returns 202. A serial
backend worker downloads the existing private media using a newly signed,
persona-scoped token, converts audio into 30-second WAV parts, transcribes all
parts with the existing STT, and indexes the complete transcript. No media
bytes, Base64, embeddings or ASR processing enter the Cloudflare Worker.
The queue is in `media-jobs.sqlite3`, retries interrupted jobs on process
restart and exposes a scoped per-source status. A silent/passive recording
finishes with an explicit no-speech status rather than invented words.
Current bounds: 110 MB fetched, 20 minutes/40 parts, 180-second conversion
timeout. The timestamped transcript is coarse audio-chunk timing, not forced
alignment or speaker diarisation. Mixed/uncertain speakers remain excluded
from style until the owner identifies the target; no automatic speaker-ID
accuracy claim is made.

`POST /api/rag/style-attribution` updates source eligibility immediately.
The owner-checked asset PATCH and bilingual upload-list checkbox expose it
without changing avatar training or replacing the cloned voice. Revocation
and deletion propagate to the style store and queued/in-flight media jobs.
Status endpoints return metadata only; original wording stays private.

The first current-persona backfill confirmed that both audible recordings
contain the same 366-character scripted reading and the other video has no
audio. All jobs completed, but the spontaneous-style corpus is correctly
empty. Do not claim that this repair trained a faithful individual style:
new natural conversation/writing examples are still needed.

Evaluation: `test_style_evidence.py` plus `verify-style-pipeline.py` cover
source provenance, bilingual paths, isolation, revocation and cleanup.
`scripts/test-persona-style.mjs` guards the Worker integration. Deterministic
held-out sentences do not enter the style prompt; an end-to-end blind style
evaluation must also prevent their factual-RAG retrieval. This implementation
does not fine-tune an LLM or establish a human-rated fidelity score.
