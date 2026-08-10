import { copyFile } from "node:fs/promises";

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
];

await Promise.all(pages.map(([source, destination]) => copyFile(source, destination)));
