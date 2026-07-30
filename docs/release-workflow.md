# Production release workflow

Use one command for every production update:

```bash
npm run release -- "describe the change"
```

It always follows this order:

1. Runs linting, TypeScript checking, and a Next.js production build.
2. Stages source files covered by `.gitignore`, refuses credential-like paths,
   and commits the change on `main`.
3. Pushes that commit to `Abbthan/digital-persona` on GitHub.
4. Deploys exactly that source state to Cloudflare with Wrangler.

This ordering is intentional: no Cloudflare deployment happens until the
matching source revision is stored on GitHub. If verification or the GitHub
push fails, the script stops before it can deploy. If Cloudflare fails after a
successful push, the source is still safely recorded and the previous live
Worker remains available.

`npm run deploy` is intentionally an alias for `npm run release`, so the
familiar deployment command cannot accidentally bypass GitHub. The internal
`npm run deploy:cloudflare` command is reserved for the release script and
emergency recovery only; do not use it for normal product changes.

The script never handles `.env*`, `.dev.vars`, private keys, model weights,
Chroma runtime data, Node modules, or build artifacts. Keep all credentials
in encrypted Cloudflare Worker secrets / server secret stores rather than in
Git.
