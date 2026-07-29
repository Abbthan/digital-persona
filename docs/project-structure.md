# Project structure

The project is split by responsibility while keeping Next.js's required routing
files in `app/`. This makes the organization clearer without changing a URL,
API endpoint, or Cloudflare deployment behavior.

```
app/                         Next.js route adapters and root layout only
front_end/
  components/                Browser-facing UI, design, modals, dashboard UI
  pages/                     Marketing page implementations
  state/                     Client state, UI contexts, browser API clients
back_end/
  api/                       API endpoint implementations (auth, accounts, personas, billing)
  services/                  Database, session, email, storage, moderation, and AI services
shared/                      Browser/server-safe validation, pricing, and utility code
prisma/                      Database schema and migration history
generated/prisma/            Prisma-generated client; do not edit manually
```

## Adding code

- Put visual or interactive browser UI in `front_end/components/`.
- Put client state or `fetch` helpers in `front_end/state/`.
- Put a new dynamic endpoint in `back_end/api/`, then add a small matching
  `app/api/.../route.ts` re-export so its public URL stays under `/api`.
- Put database, authentication, external-service, storage, and future persona
  AI logic in `back_end/services/`.
- Put only code that is safe to import from both browser and server in `shared/`.

The small files in `app/` are intentional framework adapters: Next.js uses
them to map public URLs and route handlers. They contain no application logic.
