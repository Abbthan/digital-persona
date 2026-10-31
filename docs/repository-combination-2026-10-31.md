# ECHO repository comparison and combination — 31 October 2026

## Compared revisions

- Existing ECHO: `Abbthan/digital-persona`, `dbbe033`.
- Incoming: `zhangligei/digital-persona`, `6e54ec9`.
- Common ancestor: `785c0a1`. The incoming branch has seven commits after this ancestor; ECHO has five. This is a three-way history merge, not a replacement of ECHO's tree.

## Differences and decisions

| Area | Incoming changes | Combined result |
| --- | --- | --- |
| Admin and deployment | Incoming branch predates ECHO's admin studio and CI additions | Retained ECHO's entire admin studio, bilingual overrides, GitHub target, type generation, static shells, version endpoint and release workflow |
| Speech recognition | Auto selection and spoken-variety metadata, including Shanghainese | Added Auto beside the existing three manual choices. Corrected upstream code that forced manual Mandarin/Wu settings back to Auto. Legacy GPU responses remain compatible |
| Persona replies | Spoken-variety prompting and bounded fallback text during provider outages | Included. Outage fallback is template text, not a successful memory-grounded LLM reply; it is logged as degraded |
| Avatar motion | Silence-aware mouth classification, varied blink timing, procedural-idle refinements and verification scripts | Included code and tests. These require installation/restart on the GPU host to change the running renderer; a website deployment does not apply Python patches |
| Anime demo | `/demo`, a CSS-animated character, streamed cloud TTS, timing measurements and an optional reference sample | Included separately from realistic LiveTalking. Cloud calls require a verified account; anonymous visitors retain the clearly labelled local fallback |
| Separate demo proxy | A standalone Worker, KV config and origin-sync service files | Retained as an independent operations project. Excluded its generated runtime types from the main app's compilation/lint. Not deployed over ECHO or used to replace ECHO's named tunnel |
| Database | Changes only the STT default to `auto` | Migration retained, no existing rows rewritten. New persona creation explicitly writes `auto` so the website does not depend on applying the default-only migration first |
| Dependencies | Lockfile metadata/platform changes | No package-version upgrades or new application dependencies |

## Preserved infrastructure

The production Worker remains `echo-digital-persona`, serving `echodigitalpersona.com` and `www.echodigitalpersona.com`. Hyperdrive `959e1f8776a449d69ce4f54abe075176`, the `digital-persona-ethan` R2 bucket, existing runtime secrets, GPU endpoint configuration and GitHub-to-Cloudflare build connection are unchanged. No secrets are imported from the other repository or committed. No writes are made to `zhangligei/digital-persona`.

## Verification and limits

- Full OpenNext/Cloudflare build, TypeScript and existing ten admin regressions.
- Speech-routing compatibility regression: `node --test scripts/test-upstream-integration.mjs`.
- GPU utility tests: `python3 -m unittest gpu_services.wenetspeech_wu.test_selection gpu_services.livetalking_gateway.test_avatar_runtime gpu_services.livetalking_gateway.test_procedural_idle` (22 tests, three optional image-dependency tests skipped locally).
- Deployment is verified using the GitHub Workers Builds check and matching `/version.json` on both domains.
- Signed-in real-persona audio/video and the new GPU runtime changes require the GPU services to be available and separately verified; a web build alone does not establish that those renderer patches are running.
