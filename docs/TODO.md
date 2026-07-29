# TODO — what's real vs. placeholder

Everything in this list is intentionally stubbed per the phase specs (Phase 0
said not to build AI/chat inference; later phases explicitly asked for
placeholders with TODOs). Nothing here is an oversight — it's what's left
before this product is production-ready.

## External providers

- **Email** (`lib/email.ts`) — real, not a stub. Registration confirmation
  codes send via SMTP (nodemailer) through Feishu Mail, from
  `customerservice@echodigitalpersona.com`. Credentials are in `.env`
  (`SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD`); `isEmailDeliveryConfigured()`
  gates registration/resend on all three being set.
- **Social media import** (`lib/social-profile.ts`,
  `app/api/personas/[id]/import-social/route.ts`) — real, not a stub, within
  a hard limit: it fetches the public profile page (allowlisted hosts,
  manual bounded redirects, HTTPS/port checks, 12s timeout, 2MB cap) and
  compacts whatever's in that page's own title/description/meta tags into a
  readable `{platform}.{account}.txt` note, stored as a `social_link`
  `PersonaAsset` — same list, same delete flow as every other upload. It
  does **not** and structurally **cannot** read individual posts this way:
  Instagram/Facebook/X/YouTube/Xiaohongshu render post content via
  JavaScript behind an auth wall, and scraping around that would violate
  their terms of service. Reading actual post history needs that platform's
  official API with the account owner's OAuth consent — an unwired
  per-platform provider integration, same category as `lib/payment.ts`.

## Other providers (still stubbed, none integrated)

- **Payment** (`lib/payment.ts`) — `paymentProvider` is a mock that returns
  fake customer/subscription IDs and never talks to a real processor. No
  `/api/billing/webhook` route exists, so renewals/cancellations/failed
  payments from a real provider would never sync back to the `Subscription`
  table. `PAYMENT_PROVIDER_SECRET_KEY` / `PAYMENT_PROVIDER_PUBLIC_KEY` in
  `.env.example` are placeholders.
- **AliPay / WeChat Pay** (`components/billing/CheckoutModal.tsx`) — the QR
  step is a static placeholder; no real payment is initiated or polled.
- **Content moderation** (`lib/moderation.ts`) — a static wordlist substring
  check on persona names. Trivially bypassed (typos, other languages,
  context-dependent abuse); not a real moderation system.
- **AI persona replies** (`back_end/services/persona-ai.ts`) — real,
  retrieval-grounded replies are now generated through the configured
  server-only LLM. Each call uses the current message, a bounded recent chat
  window, relevant persona-scoped RAG excerpts, and the selected voice
  reference transcript. It is prompting/retrieval rather than a model
  fine-tune; raw R2 files and cross-account data are not sent to the model.
- **Persona memory / RAG ingestion** (`back_end/services/persona-rag.ts`,
  proxied to a standalone FastAPI service on the GPU box) — real, not a
  stub; see `docs/persona-rag.md` for the full picture. Every uploaded
  document (PDF/DOCX/TXT) is ingested: native text plus OCR of any images
  embedded in it (`chi_sim+eng`, so Chinese and English both work), chunked
  and embedded with a real bilingual model (`BAAI/bge-m3`) into a persisted
  Chroma vector store. Both sides of each real chat exchange are ingested
  asynchronously. Deleting a document or message does a real, exact,
  selective delete from the vector store — unlike the avatar/voice models,
  no full-retrain approximation is needed. Retrieval is genuinely semantic
  and cross-lingual, not keyword search.
- **Speech-to-text** (`front_end/components/dashboard/PersonaConversationView.tsx`)
  — real, not a stub. The mic is always-on once toggled, not push-to-talk: a
  browser-side voice-activity-detection loop (Web Audio `AnalyserNode`,
  volume threshold) segments speech from a continuous stream, cutting an
  utterance after ~1.5s of silence and starting the next `MediaRecorder`
  segment immediately so the user can keep talking without touching the
  button again. Each segment is transcribed via the GPU box's Whisper model
  (`POST /api/personas/[id]/transcribe` → `back_end/services/livetalking.ts`'s
  `transcribeVoiceClip()` → LiveTalking's ephemeral `/api/voice/transcribe`,
  nothing persisted) and sent as a real chat message, which now receives a
  retrieval-grounded LLM reply. Requires
  `LIVETALKING_SERVER_URL`/`LIVETALKING_SESSION_SECRET`, same as the avatar
  integration below.
- **Real-time avatar video/audio, per-persona trained** (`front_end/components/dashboard/LiveTalkingAvatar.tsx`,
  `back_end/services/livetalking.ts`, `back_end/services/persona-training.ts`,
  `back_end/api/personas/[id]/live-session/route.ts`) — real, not a stub.
  Each persona gets its own trained MuseTalk 1.5 avatar (FP16) and its own
  CosyVoice zero-shot voice clone, both real GPU jobs on a standalone
  LiveTalking + CosyVoice stack (github.com/lipku/LiveTalking,
  github.com/FunAudioLLM/CosyVoice) running on a separate box, reachable
  from the public internet (see `docs/livetalking-integration.md`'s
  "Connectivity" section). Training triggers automatically: once at initial
  creation (the "Done" button in the wizard), and again on any later
  upload/delete of a video, facial scan, or audio file — a delete that
  removes the only source "unlearns" it (there's no partial/selective
  unlearning for either model, so this is a full retrain from whatever
  assets remain, not a surgical removal — the RAG system above is the
  exception, with real selective deletion). Avatar source priority: an
  uploaded/recorded video **confirmed via real face-recognition comparison
  to show the same person as the persona's facial scan** first, else the
  facial scan photo itself (looped into a short clip) — an uploaded video
  that doesn't match never gets used, so a mis-tagged or generic video can't
  end up defining someone else's avatar. Voice source: the one dedicated
  voice recording, else the largest uploaded audio file; its transcript
  (needed as CosyVoice's own prompt_text) comes from LiveTalking's bundled
  openai-whisper "base" model — real but the smallest/fastest tier, so
  transcription accuracy is modest, not high-fidelity. The browser opens a
  genuine WebRTC session directly to LiveTalking for the actual stream, and
  each chat reply from `getPersonaReply()` above is sent to that avatar over
  `/human` so it visibly lip-syncs and speaks the generated text — in the
  cloned voice for a trained persona, or via a real-time EdgeTTS fallback
  for one that isn't trained yet (CosyVoice's TTS class used to crash
  outright with no voice reference; now every persona is audible from the
  start). Auth is a short-lived HMAC-signed token this app mints per call —
  LiveTalking has no auth of its own, so a matching middleware was added to
  its `app.py`. Falls back to the server's generic demo avatar/voice (with
  an on-screen note) if a persona has no video/facial scan or no audio yet.
  - **Cartoon avatar style has no model behind it.** The name-entry step
    (`front_end/components/persona-wizard/NameModal.tsx`) lets you pick
    Realistic or Cartoon, persisted as `Persona.avatarStyle` — but Cartoon is
    blocked client- and server-side with a clear message, since only the
    Realistic/MuseTalk pipeline above is wired up.

## Known gaps in what's built

- **Subscription expiry isn't automated.** Cancelling sets status to
  `"canceling"` and correctly keeps paid access until `currentPeriodEnd`
  (see `lib/limits.ts`), but nothing ever flips it to `"none"` once that date
  passes — there's no scheduled job. Today, a "canceling" subscription grants
  paid access forever.
- **Persona status is binary in practice.** The `Persona.status` field
  supports arbitrary strings (`draft`/`active`/etc.), and `"processing"` is
  used for real now (avatar/voice training runs and is polled — see above),
  but the UI still only distinguishes mid-wizard (`draft`) from done
  (`active`); there's no dedicated "training in progress" state shown
  separately from `active`'s existing `PersonaTrainingProgress.tsx`
  indicator. RAG ingestion (document/conversation embedding) doesn't affect
  `status` at all — it's fire-and-await on the request that triggered it,
  not a tracked background job.
- **No file-type/virus validation on uploads.** `PersonaAsset` uploads
  (`app/api/personas/[id]/assets/route.ts`) check MIME type loosely and cap
  profile pictures at 5MB, but don't validate that a file's contents actually
  match its declared type, and there's no malware scanning.
- **No rate limiting** beyond the 60s email-verification-resend cooldown.
  Login, registration, and persona/asset creation have no throttling — a
  script could hammer any of these endpoints.

## Infra notes for whoever deploys this

- Several npm packages (`@prisma/engines`, `prisma`, `sharp`, `unrs-resolver`)
  have install scripts this environment left pending approval
  (`npm warn allow-scripts`). Run `npm approve-scripts --allow-scripts-pending`
  (after reviewing what they do) before relying on a fresh `npm install` in a
  new environment — some of Prisma's own tooling depends on its postinstall
  step having run.
- `DATABASE_URL` must point at Supabase's **session pooler**
  (`aws-1-ap-northeast-2.pooler.supabase.com:5432`), not the direct
  connection host — the direct host resolves IPv6-only and won't be reachable
  from IPv4-only environments. See the `memory` note from setup if this ever
  needs to be reconfigured.
