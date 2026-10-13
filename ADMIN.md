# ECHO website studio / 网站后台

Open `https://echodigitalpersona.com/admin/`. This is the website editor; it does not grant access to private personas, conversations, uploads or GPU administration.

## Editor access

Use a GitHub account with write access to `Abbthan/digital-persona`. Create a dedicated fine-grained personal access token limited to that repository with **Contents: Read and write** and **Checks: Read**. The latter lets the editor show Cloudflare build checks. The token is sent only to `api.github.com` and retained only in the tab's memory, never localStorage, cookies, source files or Cloudflare. Refreshing or closing the tab requires reconnecting. Use a separate token per collaborator and revoke it when access should end.

## Editing and publishing

1. Edit English/Chinese public website copy, replace an existing public image, or edit an allowed public page source file.
2. Select Review & publish, enter a change description, then confirm.
3. One commit is created on `main`, using the original file SHA. If someone edited that file concurrently, the update is rejected so their work is not overwritten. Preserve your draft before reloading.
4. Cloudflare Workers Builds must be connected to the repository. A successful commit alone is not proof of deployment. Refresh build status and verify the live domain before declaring success.

Text changes live in `shared/site-content.json`, using original English strings as stable keys. Existing translations remain the fallback. Overrides are applied to `/`, `/about`, `/pricing` and `/faq`; they do not alter user-generated conversations or uploaded material. Blank text intentionally hides the corresponding copy. Some copy split across multiple React text nodes requires editing the public page source instead.

Public PNG/JPEG/WebP replacements must use the existing format and canvas dimensions and be at most 5 MB. Private R2 media is never listed. Source editing is limited to public page/marketing components, the public stylesheet, and selected documentation. Credentials, authentication, billing, database schemas, GPU services and deployment workflows cannot be edited here.

## Cloudflare build connection

Connect the **existing** `echo-digital-persona` Worker to `Abbthan/digital-persona`, production branch `main`, root `/`:

- Build command: `npm run build:cloudflare`
- Deploy command: `npm run upload:cloudflare`
- Production branches: `main` only
- Preview branches: disabled until separate non-production resources are configured

Workers Builds installs dependencies from the lockfile. The build script generates Prisma without connecting to the database, runs admin regressions and lint, creates the OpenNext bundle and prepares static shells. Upload retains dashboard runtime variables; existing Worker secrets, Hyperdrive, R2, domains and GPU endpoints are preserved.

Do **not** use `npm run release` as a Cloudflare build command: it is a local commit-and-push helper and would cause recursive releases. No database migration or GPU deployment runs automatically from website builds.

`/version.json` in each prepared deployment contains the source commit and build timestamp. Request it without cache and compare its `commit` with GitHub `main` to prove deployment parity.

## Local collaboration

Before editing: `git pull --ff-only origin main`. Browser publication updates GitHub and the connected Cloudflare build, not a Mac folder by itself. Pull again before your next local edit. Never force-push over studio changes.

`npm run release -- "Describe the change"` verifies, commits and pushes local changes. Once Workers Builds is connected, GitHub is the normal deployment trigger. `npm run deploy:cloudflare` is available for a controlled manual recovery, using the existing Worker and bindings.

Tests: `npm run test:admin`. Build: `npm run build:cloudflare`.

## Setup record — 14 October 2026

The editor and build commands were implemented and pushed to the existing repository. The full OpenNext build, TypeScript check and admin regressions passed; English/Chinese login-page rendering was checked in the browser. Both custom domains expose the deployed admin shell and `/version.json` for parity verification.

**Automatic Builds connection is still pending approval.** The existing `digital-persona build token` displayed missing-permission warnings, and automatic approval review rejected saving that connection. The Cloudflare dashboard form has been prepared with repository `digital-persona`, branch `main`, the commands above, previews disabled, and the supported **Create new token** option selected. No new token or automatic-build connection has been saved yet. Creating this token grants Cloudflare Builds deployment access to account resources; review its permissions before completing Connect. A manual deployment of the pushed commit was used to publish the editor in the meantime.
