#!/usr/bin/env node

/**
 * ECHO's single production release path:
 *   verify -> stage safe source -> commit -> GitHub push -> Cloudflare deploy
 *
 * Keeping GitHub before Cloudflare means every live deployment has an
 * immutable, reviewable source commit. It intentionally never reads or
 * writes secrets; .gitignore and the additional staged-file guard keep local
 * credentials out of the repository.
 */
import { execFileSync } from "node:child_process";

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}

function output(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

const message = process.argv.slice(2).join(" ").trim()
  || `release: ${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}`;

const disallowedPath = /(^|\/)(?:\.env(?:\.|$)|\.dev\.vars$|.*\.(?:pem|key|p12|pfx)$|id_(?:rsa|ed25519)(?:\.pub)?$)/i;

try {
  if (output("git", ["branch", "--show-current"]) !== "main") {
    throw new Error("Production releases must be made from the main branch.");
  }

  run("git", ["diff", "--check"]);
  run("npm", ["run", "verify"]);

  // This is deliberately after verification so generated local build files
  // cannot become part of the commit. Ignored files (secrets, Node modules,
  // build artifacts, runtime RAG/model data) are never staged by git add.
  run("git", ["add", "--all"]);
  const staged = output("git", ["diff", "--cached", "--name-only"])
    .split("\n")
    .filter(Boolean);
  const unsafe = staged.filter((path) => disallowedPath.test(path));
  if (unsafe.length > 0) {
    throw new Error(`Refusing to release credential-like file(s): ${unsafe.join(", ")}`);
  }

  if (staged.length > 0) run("git", ["commit", "-m", message]);
  else console.log("No source changes to commit; continuing with the existing main commit.");

  // Force HTTP/1.1 because this Mac's default Git HTTP/2 TLS negotiation has
  // previously failed while the same GitHub remote works correctly over 1.1.
  run("git", ["-c", "http.version=HTTP/1.1", "push", "origin", "HEAD:main"]);
  run("npm", ["run", "deploy:cloudflare"]);
  console.log("\nRelease complete: GitHub main is synchronized, then Cloudflare was deployed.");
} catch (error) {
  console.error(`\nRelease stopped before a partial deployment: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
