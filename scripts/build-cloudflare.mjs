import { execFileSync } from "node:child_process";

// This generated file is intentionally gitignored. A clean CI checkout must
// recreate the binding types before Next's TypeScript check, just as it
// recreates the Prisma client below. No production credentials are needed.
execFileSync("npm", ["run", "cf-typegen"], { stdio: "inherit" });

// A fresh Git clone has no generated Prisma client or database credentials.
// Generation needs a syntactically valid URL, but never connects to a DB.
// This placeholder is confined to generation, not the application build.
execFileSync("npx", ["--no-install", "prisma", "generate"], {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL:
      process.env.DATABASE_URL ||
      "postgresql://build:build@localhost:5432/build",
  },
});
execFileSync("npm", ["run", "test:admin"], { stdio: "inherit" });
execFileSync("node", ["--test", "scripts/test-upstream-integration.mjs"], { stdio: "inherit" });
execFileSync("node", ["--test", "scripts/test-live-session-access.mjs"], { stdio: "inherit" });
execFileSync("node", ["--test", "scripts/test-persona-model-transport.mjs"], { stdio: "inherit" });
execFileSync("node", ["--test", "scripts/test-persona-style.mjs"], { stdio: "inherit" });
execFileSync("npm", ["run", "lint"], { stdio: "inherit" });
execFileSync("npx", ["--no-install", "opennextjs-cloudflare", "build"], {
  stdio: "inherit",
});
execFileSync("npm", ["run", "prepare-static-assets"], { stdio: "inherit" });
