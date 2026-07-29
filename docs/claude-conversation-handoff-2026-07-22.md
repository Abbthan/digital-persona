# Compact conversation handoff — 2026-07-22

## Project context

- Next.js 16 App Router + TypeScript + Tailwind v4 + Prisma/PostgreSQL + Supabase Storage.
- Read `AGENTS.md` before changing Next code; it requires consulting the bundled Next docs for relevant APIs.
- The project is not a Git worktree in this environment, so use file inspection rather than `git diff/status` for review.

## Delivered UI work

- Theme changes now interpolate semantic colors for 280ms and respect reduced motion. Appearance labels directly select Light/Dark/System while preserving thumb dragging.
- Account Settings is a bounded, centered, internally scrollable modal. Its error messages are red. Profile images accept only PNG/JPG/JPEG up to 1MB, checked in the picker and API.
- All user-facing error/warning feedback was standardized to red; interactive actions remain blue.
- Order Teddy has an understated `Go Back` link to `/dashboard`.
- The global dock is hidden on `/dashboard` and child routes. The dashboard has matching top/bottom spacing and a `Return Home` sidebar item.
- Dashboard navigation is a desktop sidebar and a narrow-screen animated overlay panel with dark/blurred backdrop. It collapses after selecting a persona.
- Dashboard uses a viewport-bounded layout. The menu and chat messages scroll internally, and exactly one right-side pane renders: one conversation or the initial empty pane.
- Logout invalidates stale auth refreshes, clears client auth state, returns dashboard users home, and refreshes other routes.

## Persona persistence and management

- Personas, `PersonaAsset`s, and `ChatMessage`s are persisted in Prisma/Postgres and are account-scoped through `Persona.userId`. Existing chat/message, asset-upload, and persona APIs check ownership before reading/writing.
- `DashboardShell` immediately filters a just-deleted persona locally (`deletedPersonaIds`) before `router.refresh()`, clears it if selected, and shows the empty pane. This prevents stale conversation panes.
- Persona rows show a `…` button on hover or while selected. It opens `components/dashboard/PersonaManagerModal.tsx`.
- The manager is a wide, scrollable modal and provides:
  - Same upload choices as creation: photos, video, facial scan, audio upload/recording, social links, documents.
  - Collapsible upload list; sort by upload date or name.
  - Single-file Delete and multi-select checkbox delete, both with permanent-delete confirmation.
  - Delete persona confirmation with a three-second lockout and current-password entry.
- Asset APIs:
  - `GET /api/personas/[id]/assets` lists metadata for an owned persona.
  - `DELETE /api/personas/[id]/assets/[assetId]` removes the storage object and DB row after ownership checks.
  - `DELETE /api/personas/[id]` removes asset storage objects then deletes the persona; DB relations cascade assets/chat rows.
- Saved/active persona deletion requires current password server-side (`verifyPassword`). The only bypass is `discardDraft: true` for a `status === "draft"` persona, used only by the unfinished upload wizard.

## Creation flow

- Name submission creates a temporary database `draft`, because asset uploads need a persona ID.
- `UploadWizard` marks it active only on Done (`/finish`). Its X/backdrop close sends `DELETE { discardDraft: true }`, deleting the draft and any uploaded media without a password.
- If draft deletion/finish fails, the wizard remains open and displays a red error.

## Social profile import

- `lib/social-profile.ts` validates supported public HTTPS profile URLs for Instagram, Facebook, X/Twitter, YouTube, and Xiaohongshu.
- Server-side import uses allowlisted hosts, manual bounded redirects, HTTPS/port checks, 12-second timeout, 2MB HTML cap, and compact metadata extraction only.
- It stores a JSON snapshot as one `social_link` asset named `platform.account` (shown in the asset list), containing source URL, fetch time, platform/account, title, description, and canonical URL.
- Important limitation: this **does not import posts or full profile/page content**. Sites commonly block scraping; importing post content should use each platform’s authorized API or a user-provided export.

## Manual account data operation performed

- A direct database update granted account `HerrAbbthan` an active manual `annual` entitlement through end-of-day 2027-12-09 in Asia/Shanghai (`2027-12-09T15:59:59.999Z`), with a matching `Subscription` history row.
- A prior report that login said “database is not reachable yet” was not investigated to resolution because the request was superseded. A privileged direct DB connection did work after sandbox network escalation.

## Validation and key files

- Repeatedly passed: `npm run lint` and `npx tsc --noEmit`.
- Production build remains environment-blocked because `next/font` cannot fetch Google Inter in this sandbox.
- Main files changed/added:
  - `app/globals.css`, `components/account/ThemeSlider.tsx`
  - `components/modals/AccountSettingsModal.tsx`, `components/modals/AuthModal.tsx`
  - `components/GlobalDock.tsx`, `components/dashboard/DashboardShell.tsx`, `components/dashboard/PersonaConversationView.tsx`, `components/dashboard/PersonaManagerModal.tsx`
  - `components/persona-wizard/UploadWizard.tsx`, `components/persona-wizard/PersonaWizard.tsx`, `components/persona-wizard/SocialLinkTile.tsx`
  - `app/api/personas/[id]/route.ts`, `app/api/personas/[id]/assets/route.ts`, `app/api/personas/[id]/assets/[assetId]/route.ts`, `app/api/personas/[id]/import-social/route.ts`
  - `lib/auth-context.tsx`, `lib/social-profile.ts`

## Earlier rolling handoff

`docs/claude-handoff-2026-07-22.md` contains the earlier chronological bullet list; this file is the preferred compact handoff.
