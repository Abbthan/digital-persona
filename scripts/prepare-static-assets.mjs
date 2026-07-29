import { copyFile } from "node:fs/promises";

// OpenNext keeps Next.js' pre-rendered documents in .next/server/app rather
// than in its static-assets folder. Copy the public pages into that folder so
// Cloudflare Assets answers them before the Worker starts. This keeps marketing
// navigation out of the Worker's tight CPU budget while all API and dashboard
// routes continue to use the existing server implementation.
const pages = [
  [".next/server/app/index.html", ".open-next/assets/index.html"],
  [".next/server/app/about.html", ".open-next/assets/about.html"],
  [".next/server/app/pricing.html", ".open-next/assets/pricing.html"],
];

await Promise.all(pages.map(([source, destination]) => copyFile(source, destination)));
