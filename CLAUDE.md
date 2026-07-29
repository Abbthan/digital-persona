# digital_persona

@AGENTS.md

## ECHO 回响

Next.js 16 (App Router) + TypeScript + Tailwind CSS v4 project for ECHO 回响, an AI-persona platform. Design system: Apple, adopted from `awesome-design-md/design-md/apple/DESIGN.md` and copied into [docs/design-system.md](docs/design-system.md). Tailwind theme tokens (color, type, spacing, radius, shadow, motion) live in `app/globals.css` under `@theme`. Reusable primitives are in `components/ui`. Prisma schema is in `prisma/schema.prisma`. `lib/` holds stub helpers (auth, db, payment) — no real provider integration or AI inference logic yet, that's intentionally out of scope until specified.

## Design reference library

`awesome-design-md/` is a cloned copy of [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) — a curated collection of `DESIGN.md` files (design tokens, typography, component styling, layout rules, do's/don'ts) reverse-engineered from real product sites (Stripe, Linear, Vercel, Notion, Apple, Tesla, etc).

Full index: [awesome-design-md/README.md](awesome-design-md/README.md). Each entry lives at `awesome-design-md/design-md/<name>/DESIGN.md`, with `preview.html` / `preview-dark.html` showing the rendered palette and components.

When doing web/UI work in this project:
- If the user names a reference site/aesthetic ("make it look like Stripe", "Linear-style"), check `awesome-design-md/design-md/<name>/DESIGN.md` first and pull colors, type scale, spacing, and component rules from it before improvising.
- To adopt a design system for this project, copy the relevant `DESIGN.md` into the project root (per the collection's own usage convention) rather than reading it out of the submodule each time.
- To refresh the collection: `cd awesome-design-md && git pull`.
