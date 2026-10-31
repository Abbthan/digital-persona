import { copyFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";

// OpenNext keeps Next.js' pre-rendered documents in .next/server/app rather
// than in its static-assets folder. Copy deterministic HTML shells into that
// folder so Cloudflare Assets answers them before the Worker starts. The
// dashboard contains no account data in its HTML: authentication and persona
// data are fetched client-side from explicitly non-cacheable JSON endpoints.
// This keeps both public pages and the dashboard shell out of the Worker's CPU
// budget without caching any per-account response.
const pages = [
  [".next/server/app/index.html", ".open-next/assets/index.html"],
  [".next/server/app/about.html", ".open-next/assets/about.html"],
  [".next/server/app/pricing.html", ".open-next/assets/pricing.html"],
  [".next/server/app/faq.html", ".open-next/assets/faq.html"],
  [".next/server/app/dashboard.html", ".open-next/assets/dashboard.html"],
  [".next/server/app/admin.html", ".open-next/assets/admin/index.html"],
  [".next/server/app/demo.html", ".open-next/assets/demo/index.html"],
];

await mkdir(".open-next/assets/admin", { recursive: true });
await mkdir(".open-next/assets/demo", { recursive: true });
await Promise.all(pages.map(([source, destination]) => copyFile(source, destination)));

// A static version endpoint makes commit-to-domain parity independently
// verifiable, without database work or putting credentials into a build.
const commit = process.env.WORKERS_CI_COMMIT_SHA || process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
await writeFile('.open-next/assets/version.json', JSON.stringify({ commit, builtAt: new Date().toISOString() }) + '\n');
await writeFile('.open-next/assets/_headers', `/admin\n  X-Robots-Tag: noindex, nofollow\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.github.com; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'\n/admin/*\n  X-Robots-Tag: noindex, nofollow\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.github.com; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'\n/version.json\n  Cache-Control: no-store\n`);
