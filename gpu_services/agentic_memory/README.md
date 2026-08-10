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
