# Claude Code Build Prompts — AI Persona Platform

Stack assumed throughout: **Next.js (App Router) + TypeScript + Tailwind CSS + Prisma/Postgres**, generic payment and email provider placeholders (swap in real keys/services later). Design system: **Apple**, from `VoltAgent/awesome-design-md`.

Run these prompts **in order**, in the same Claude Code project/repo. Review and commit after each phase before moving to the next — don't paste them all at once.

---

## Phase 0 — Project setup + design system

```
Set up a new Next.js 14+ project (App Router, TypeScript, Tailwind CSS, ESLint) for a product called "ECHO回响" — a platform where users create AI personas of real people from uploaded photos, videos, audio, chat history, and social media, then converse with the persona via text or real-time video/voice chat.

Fetch the Apple design system reference from https://github.com/VoltAgent/awesome-design-md — specifically design-md/apple/DESIGN.md — and use it as the authoritative style guide for this entire project. Extract its color tokens, typography (SF Pro Display/Text scale), spacing (8px base unit), corner-radius, shadow, and motion conventions into a Tailwind theme config so every later prompt in this project inherits consistent Apple-style design without me re-specifying it. Save a copy of the fetched DESIGN.md into /docs/design-system.md so it's available for reference in later sessions.

Set up:
- Prisma with Postgres. Create initial schema models: User (id, username, email, passwordHash, emailVerified boolean, profileImageUrl, subscriptionStatus, subscriptionPlan, subscriptionRenewsAt, createdAt), EmailVerificationCode (userId, code, expiresAt, consumedAt), Persona (id, userId, name, status, createdAt), PersonaAsset (id, personaId, type [image|video|audio|text|social_link|facial_scan], url, metadata, createdAt), Subscription (id, userId, plan, status, currentPeriodEnd, provider, providerCustomerId), and a placeholder ChatMessage model (id, personaId, role, content, createdAt) for the future chat feature.
- A clean folder structure: /app for routes, /components/ui for reusable Apple-styled primitives (Button, Modal, Card, Dock, Input), /lib for auth/db/payment helper stubs, /docs for this design reference.
- Environment variable placeholders in .env.example for DATABASE_URL, SESSION_SECRET, EMAIL_PROVIDER_API_KEY, PAYMENT_PROVIDER_SECRET_KEY, PAYMENT_PROVIDER_PUBLIC_KEY — with comments explaining each is a placeholder to be filled in later with a real provider.

Do not build any AI/chat inference logic yet — just scaffold the project, schema, and design tokens. Confirm the dev server runs before finishing.
```

---

## Phase 1 — Global navigation (the floating "dock")

```
Build the global site navigation as a floating dock component, per Apple design conventions (design-md/apple/DESIGN.md, already saved at /docs/design-system.md), fixed near the top of the viewport, not spanning the full width — a centered rounded-corner pill/rectangle.

Behavior:
- At the top of any page, the dock background is solid white with a subtle shadow.
- On scroll, it transitions smoothly to a translucent frosted/blurred "liquid glass" background (backdrop-blur + translucency), matching Apple's current liquid glass material style.
- Logged-out nav items, left to right: Home, Pricing, About Us, Register.
- When a user is authenticated, replace "Register" with a Dashboard entry point and add a small profile avatar + account name element at the far right that opens the account settings modal (build a placeholder modal for now — full settings functionality comes in a later prompt).
- "Pricing" and "Register" both trigger modal overlays (build empty placeholder modals for now, wired up in later prompts) rather than navigating away, except when already on /pricing where it can just scroll/highlight.
- Dock is sticky across all pages including Home, Pricing, About Us, and Dashboard.
- Fully responsive: collapse into a compact/hamburger form on mobile widths, keeping the same rounded-rectangle Apple aesthetic.

Wire this dock into a root layout so it's present on every route. Use placeholder auth state (a simple boolean/context you can later replace with real session data) to demonstrate both logged-in and logged-out states.
```

---

## Phase 2 — Home page (parallax marketing)

```
Build the Home page (route "/", and this must be the default route the app redirects to) as a multi-section, scroll-driven marketing page for ECHO回响 — a platform for creating conversational AI personas of real people from uploaded photos, videos, audio, chat history, and social media data.

Follow Apple's product marketing page conventions from /docs/design-system.md: full-bleed sections, large confident typography, generous whitespace, and parallax/scroll-linked motion where background and foreground elements move at different speeds as the user scrolls (use Framer Motion's scroll utilities or CSS scroll-driven animations).

Structure at least these sections, each full-viewport-height:
1. Hero — "ECHO回响" as the product name/wordmark, one-line value proposition, primary CTA ("Get Started" → opens the register modal) and secondary CTA ("See Pricing" → scrolls/links to pricing).
2. "How it works" — 3-4 step visual walkthrough (upload media → we learn the person → talk to their AI persona via text or live video/voice).
3. Capability showcase — highlight the range of inputs supported (photos, chat history, documents, video, audio, live facial scan) and the two experience tiers (text-only messaging vs. full real-time visual/voice conversation for subscribers).
4. Social proof / trust section — placeholder testimonials or stats, clearly marked as placeholder content to replace later.
5. Final CTA section driving to registration.

Make all imagery placeholder (use styled gradient/blur blocks or placeholder illustrations, not real photos of people, since this product deals with real human likenesses — note this in a code comment). Ensure the page is fully responsive and that parallax effects gracefully degrade/disable for reduced-motion preferences.
```

---

## Phase 3 — About Us page

```
Build the About Us page (route "/about") using the same parallax, multi-section scroll structure and Apple design language as the Home page (see /docs/design-system.md and the Home page you already built for consistency).

Include sections for: mission/vision statement, an explanation of how the product handles sensitive personal data (uploaded likenesses, voice, video) responsibly, a placeholder team/values section, and a closing CTA back to registration or pricing. Keep all copy placeholder-quality but on-brand — I'll refine the actual wording later. Reuse shared layout/parallax primitives from the Home page rather than duplicating logic; extract shared scroll/parallax components into /components if you haven't already.
```

---

## Phase 4 — Pricing page + billing UI

```
Build the Pricing page (route "/pricing") and the pricing modal (opened from the dock's "Pricing" button on any page).

Three plans, displayed as Apple-style pricing cards:
- Monthly: $5.99/mo
- Seasonal (3 months): $12.99, billed every 3 months. Show the strikethrough original price ($5.99 × 3 = $17.99) and calculate + display the percentage discount versus paying monthly for 3 months.
- Annual: $29.99/yr. Show the strikethrough original price ($5.99 × 12 = $71.88) and calculate + display the percentage discount versus paying monthly for 12 months.

Compute the discount percentages programmatically from the base monthly price and each plan's price/duration (don't hardcode the percentages as magic numbers) so the numbers stay correct if prices change.

Below the plan cards, show accepted payment methods: credit/debit card fields (card number, expiry, CVC, name, billing address — build the form UI, do not process real payments yet), plus AliPay and WeChat Pay as selectable payment method options with their own minimal UI states (e.g., a QR-code placeholder step for AliPay/WeChat Pay flows).

Behavior:
- If the user is not authenticated and clicks "Subscribe" on any plan, open the login/register modal (from Phase 5 scope — for now, build it as a placeholder modal titled "Log in to continue" with a "Register now" link at the bottom) instead of proceeding to checkout.
- If authenticated, clicking "Subscribe" opens a checkout flow/modal within the pricing UI: select payment method → enter payment details → confirm. On confirm, call a stubbed `/api/billing/subscribe` route that would integrate with a real payment provider (leave a clear TODO and a typed interface for what a real provider integration needs: create customer, create subscription, handle webhook for renewal/cancellation) and, for now, just persist the chosen plan to the User/Subscription models from Phase 0.
- Persist and reflect current plan status: if the user already has an active subscription, show their current plan as selected/active on this page instead of offering to purchase it again, and show a "Manage billing" action instead.

Keep all of this on Apple-style rounded-corner cards and modals per /docs/design-system.md.
```

---

## Phase 5 — Full authentication + email verification

```
Implement full authentication, replacing the placeholder auth state from Phase 1.

Register/login modal:
- Triggered by the dock's "Register" button, or any gated action (e.g., subscribing while logged out).
- When open, darken/dim all background page content (an overlay behind the centered rounded-corner modal), consistent with Apple modal conventions in /docs/design-system.md.
- Two tabs/states: Login (email or username + password) and Register (username, email, password).
- Client- and server-side validation: username and email must be unique across accounts — check against the database and show inline errors if taken. Enforce reasonable password requirements (min length, etc.) and show validation errors inline, not via alert().
- Passwords must be hashed (bcrypt or argon2) before storage — never store plaintext. Use secure, httpOnly session cookies for auth state (implement with iron-session, NextAuth Credentials provider, or an equivalent — your choice, just make it production-appropriate).
- On successful login, persist the session so returning to the site (or logging in on another device) restores the same account data: profile info, personas, subscription status.

Email verification:
- On successful registration, generate a random 6-digit numeric code, store it (with an expiration, e.g. 15 minutes) against the user in EmailVerificationCode, and send it via a generic `sendEmail(to, subject, body)` helper in /lib/email.ts that currently just logs to console with a TODO to wire up a real provider (Resend, SendGrid, Postmark, etc. — read EMAIL_PROVIDER_API_KEY from env).
- Immediately after registration, show a "Verify your email" screen within the modal (or a dedicated /verify route) with 6 individual digit input boxes. On submit, validate the code server-side, mark emailVerified = true, and only then allow the user to be treated as fully logged in / able to use gated features. Include a "Resend code" action with basic rate limiting (e.g., 60 second cooldown).
- Block unverified accounts from accessing the dashboard or purchasing — redirect them back to the verification screen.

Update the dock (Phase 1) to use real session state instead of the placeholder boolean, and update the Pricing page (Phase 4) so the login/register modal it opens is this real one.
```

---

## Phase 6 — Dashboard shell

```
Build the authenticated Dashboard shell (route "/dashboard"), styled like chatgpt.com's layout, using Apple design tokens from /docs/design-system.md for colors/typography/spacing rather than ChatGPT's actual visual style.

Left sidebar:
- A rounded-corner rectangle container (not full-bleed) fixed to the left.
- Top of sidebar: profile avatar + account name/username, clickable to open the Account Settings modal (build the modal shell now; full settings functionality is a later prompt).
- Main nav items: "Personas", "Pricing" (opens the Phase 4 pricing modal), "Order Teddy" (placeholder route/page for now — a physical companion product; just scaffold an empty page it links to).
- "Personas" expands into a collapsible sub-menu, listing the user's personas (empty state: "No personas yet"), plus a "Create +" button pinned at the bottom of that expanded sub-menu. When expanded, it should push the rest of the sidebar content down smoothly (animate height, not just toggle visibility) rather than overlapping.
- Show the user's persona count against their plan limit next to "Personas" or near "Create +", e.g. "1/1" for free accounts or "2/5" for paid accounts (limits: 1 persona free tier, 5 personas paid tier — read this from the user's subscription status).

Main content area (right of sidebar): for now, show an empty/welcome state ("Select or create a persona to get started") — the real persona chat view comes in a later prompt.

Gate the whole /dashboard route: unauthenticated or unverified users should be redirected to home with the login modal triggered, not shown a broken dashboard.
```

---

## Phase 7 — Persona creation wizard

```
Build the "Create +" persona flow from the dashboard sidebar (Phase 6).

Step 1 — Name modal: a centered rounded-corner modal (background dimmed, same convention as the auth modal) asking for the new persona's name. On submit, run the name through a basic profanity/inappropriate-language filter (implement a simple wordlist-based check server-side in /lib/moderation.ts with a clear TODO to swap in a real moderation API later) — reject with an inline error if flagged, otherwise create a draft Persona record and proceed to Step 2.

Step 2 — Source upload wizard: once the name is confirmed, present an upload/collection interface with these input types (lay them out as clean Apple-style cards/tiles, organize in whatever grouping makes sense — e.g. "Media" vs "Text & Links"):
- Image upload (multi-file, drag-and-drop + file picker)
- Social media link upload (input field(s) for Instagram/Facebook/YouTube/etc. profile URLs — for now, just store the URLs against the persona and stub a `/api/personas/[id]/import-social` route with a TODO for actually scraping/fetching posts later; do not build real scraping)
- Text/document file upload (.txt, .docx, .pdf, chat export files)
- Video upload
- Facial scan (uses device camera — build the camera permission request + live capture UI using getUserMedia; save captured frames/clips as PersonaAsset records)
- Audio upload (file picker for audio files)
- Audio recorder (uses device microphone via getUserMedia/MediaRecorder to record and save clips in-browser)

Subscription gating: if the user is on the free plan, gray out and disable Video upload, Facial scan, Audio upload, and Audio recorder tiles, and overlay a small crown icon on each indicating it's a paid feature. Clicking a disabled tile should open the pricing modal rather than doing nothing. Image upload, social link upload, and text/document upload remain available on the free plan.

Enforce the persona count limit from Phase 6 (1 free / 5 paid) server-side when creating a new persona — if at the limit, don't open the name modal at all; open the pricing modal instead with a message explaining the limit.

When the user finishes the wizard (explicit "Done"/"Finish" action), mark the persona as created/active and it should now appear in the dashboard sidebar's Personas list.
```

---

## Phase 8 — Persona conversation view

```
Build the persona conversation view that renders in the dashboard's main content area (Phase 6) when a persona is selected from the sidebar.

Layout: a video/avatar display area on top, and a chat panel below it, styled like iMessage (rounded message bubbles, sent vs. received alignment/coloring, timestamps, smooth send animation).

Chat panel:
- Text input with send button, plus a microphone button for voice input (use the Web Speech API or MediaRecorder to capture audio — stub the actual speech-to-text and AI response with a clearly-marked placeholder function `getPersonaReply(message)` in /lib/persona-ai.ts that returns a canned/echo response for now, so the real AI backend can be swapped in later without touching UI code).
- Every persona reply — whether triggered by typed text or voice input — appears as a text bubble in the chat, per the spec (voice replies are always mirrored as text).

Video/avatar area:
- Only rendered/available for users with an active paid subscription. Free-tier users seeing this view should see the chat panel only, with the video area replaced by an upgrade prompt/banner (styled card explaining video conversation is a subscriber feature, with a button opening the pricing modal).
- For paid users, build the video area as a placeholder live-avatar surface (e.g., a styled container with a "connecting..." / idle state) with clear TODOs for where real-time avatar video/audio streaming would be integrated — do not build actual AI video generation.

Make sure this view reads which persona is selected (from the sidebar) and loads that persona's chat history (from the ChatMessage model) on open, and persists new messages to the database as they're sent.
```

---

## Phase 9 — Account settings modal

```
Build out full functionality for the Account Settings modal (shell was scaffolded in Phase 6), opened from the dock/sidebar profile element. Keep the centered rounded-corner modal + dimmed background convention.

Include:
- Change password: require entering the current password correctly before allowing a new password to be set; validate and hash the new password server-side.
- Upload/change profile picture: image picker, basic client-side crop/preview, upload and persist the URL to the User model.
- Change username: enforce the same uniqueness validation used at registration (Phase 5).
- Cancel subscription: clearly explain that cancelling stops future billing but the user retains access until the end of the currently paid period (read currentPeriodEnd from the Subscription model and display the exact date access ends). On confirm, mark the subscription as "cancels at period end" rather than deleting it immediately, and call a stubbed `/api/billing/cancel` route with a TODO for the real payment provider's cancellation API.

All actions should show clear success/error feedback inline in the modal (no browser alert() dialogs), matching Apple's form-feedback conventions from /docs/design-system.md.
```

---

## Phase 10 — QA pass

```
Do a full review pass across the site you've built (Home, About, Pricing, dashboard, auth, persona creation, persona chat, account settings):

1. Consistency: confirm every modal, card, and button consistently follows the Apple design tokens in /docs/design-system.md (colors, corner radii, spacing, typography) — fix any drift.
2. Responsiveness: verify the dock, pricing cards, dashboard sidebar, and persona wizard all work correctly at mobile, tablet, and desktop widths.
3. Auth guarding: verify unauthenticated/unverified users cannot reach /dashboard or any persona data via direct URL, and that free-tier limits (1 persona, no video/facial/audio uploads, no video chat) are enforced server-side, not just hidden in the UI.
4. Accessibility: check modal focus-trapping, keyboard navigation, and alt text/aria-labels on interactive elements.
5. List every TODO/stub left in the codebase (email provider, payment provider, social media scraping, real AI persona backend, moderation API) in a single /docs/TODO.md so it's clear what's placeholder vs. production-ready before this ships.

Report back a summary of what you fixed and what remains a stub.
```
