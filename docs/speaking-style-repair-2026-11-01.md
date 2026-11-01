# Speaking-style repair and source audit — 1 November 2026

## What was wrong

The persona had 103 generated replies (about 11,700 characters), 29 visitor
messages and only one 366-character source transcript in memory. All five
stored catchphrase/dialect signals were linked to generated persona replies.
The style query searched the same unfiltered pool as factual memory, so an
invented generic habit could reinforce itself. Upload presence did not mean
every recording had been transcribed into source evidence.

## Changes implemented

- Dedicated, persistent source-only style store. Generated replies cannot
  teach style, and visitor wording is not attributed to the target person.
- Separate factual and style retrieval purposes. Both reactive replies and
  proactive openings use the source-only path. Old generated style/facts are
  filtered on retrieval; raw historical conversation is preserved and labelled
  as continuity, not wording evidence. No historical chat was deleted.
- Separate English/Chinese measured summaries and original examples; no
  language-specific mannerisms are invented when examples are absent.
- Serial, durable audio/video transcription queue on the backend. The Worker
  sends a private source URL and receives a quick accepted response; it does
  not decode, transcribe, embed or buffer the media. Existing STT is reused.
- Full source transcripts and coarse 30-second audio-chunk timestamps are
  retained. These are not word alignment or automatic speaker diarisation.
- Owner attribution control and bilingual scripted/silent/processing status
  in the existing upload list. Checking an attribution box does not change
  avatar training or the voice reference. Unverified/mixed material and
  scripted readings do not become spontaneous-style examples.
- Source deletion/revocation includes derived style and queued jobs. Mid-job
  deletion is checked before and after indexing to prevent resurrection.
- Held-out sentences are excluded from style prompts. End-to-end blind
  evaluation additionally needs to withhold those sources from factual RAG;
  no human-rated fidelity score or fine-tuning is claimed.

## Actual result for the existing “me” persona

The owner confirmed that only the target person speaks in its audio and two
videos. Only those existing recordings were queued for this backfill; no
other persona was modified.

All three jobs completed. The audio and speaking video contain the same
366-character scripted reading. The remaining video has no audio track.
Consequently the correct current result is **zero verified spontaneous-style
sources** in both English and Chinese, rather than a fabricated style profile.

These clips can still serve voice/visual preparation and factual context.
They do not establish how the person spontaneously chooses words, jokes,
constructs sentences or switches languages. The product should now stop
learning “man/bro” from its own output, but genuine style imitation needs
representative original material.

Practical next input: an authorised, unscripted conversation or voice note,
and/or messages written by the person. Include each language whose style
matters. Start with several varied examples rather than repeating a supplied
script. Confirm only target-authored wording in the upload list; leave mixed
speakers/quotations unconfirmed unless target segments are separated. There
is no fixed duration that guarantees a faithful personality replica.

## Verification and operational boundaries

- Full Cloudflare production build, TypeScript and 29 JavaScript regressions
  passed; lint retains one pre-existing unused-disable warning in auth-context.
- 12 Python regressions passed, including source provenance, bilingual paths,
  persona isolation, revocation, durable queue state and prior memory auth tests.
- Synthetic API test passed source-only retrieval, English/Chinese examples,
  cross-persona rejection, unauthenticated rejection and revocation; its
  disposable test persona was deleted in cleanup.
- Real job status correctly reports two scripted sources and one silent source;
  no fake style evidence was injected to make an empty profile appear trained.
- Only the memory API was restarted. The running avatar, CosyVoice, STT,
  tunnel, production model selection, domain, TURN and storage/database bindings
  were not reconfigured. Existing extractions/legacy data were not purged.
- Source rollback copy:
  `/home/user/echo/runtime/backups/agentic-memory-before-style-20261101`.
  New private sidecars are under the existing memory runtime directory.

AVTR-1 is a separate proposal in `avtr-1-live-avatar-proposal-2026-11-01.md`;
it has not replaced the current renderer or been commercially licensed here.
