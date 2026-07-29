/*
 * One-time media migration. It copies every private object from the legacy
 * Supabase Storage bucket to the private R2 bucket using the exact same key,
 * so Postgres records continue to contain only opaque object addresses.
 *
 * Run without arguments to copy+verify. Run with --delete-source only after a
 * successful copy to remove the Supabase source objects and reclaim storage.
 */
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";

const deleteSource = process.argv.includes("--delete-source");
const sourceBucket = process.env.SUPABASE_STORAGE_BUCKET;
const destinationBucket = "digital-persona-ethan";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !sourceBucket) {
  throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_STORAGE_BUCKET are required.");
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function runWrangler(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["wrangler", ...args], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`wrangler ${args.join(" ")} failed (${code})`)));
  });
}

async function listAll(prefix = "") {
  const paths = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.storage.from(sourceBucket).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`Could not list ${prefix || "bucket root"}: ${error.message}`);
    for (const entry of data ?? []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) paths.push(...await listAll(path));
      else paths.push(path);
    }
    if (!data || data.length < 1000) return paths;
    offset += data.length;
  }
}

async function migrateOne(path, directory) {
  if (!path || path.includes("..") || path.startsWith("/")) throw new Error(`Unsafe object key: ${path}`);
  const { data, error } = await supabase.storage.from(sourceBucket).download(path);
  if (error || !data) throw new Error(`Could not download ${path}: ${error?.message ?? "empty response"}`);

  const source = Buffer.from(await data.arrayBuffer());
  const stem = createHash("sha256").update(path).digest("hex");
  const sourceFile = join(directory, `${stem}-${basename(path)}`);
  const verifyFile = join(directory, `${stem}.verify`);
  await writeFile(sourceFile, source);
  try {
    // Wrangler otherwise defaults object commands to Miniflare's local R2
    // emulator. The migration must always address the production bucket.
    await runWrangler(["r2", "object", "put", `${destinationBucket}/${path}`, `--file=${sourceFile}`, "--remote"]);
    await runWrangler(["r2", "object", "get", `${destinationBucket}/${path}`, `--file=${verifyFile}`, "--remote"]);
    const copied = await readFile(verifyFile);
    if (source.length !== copied.length || sha256(source) !== sha256(copied)) {
      throw new Error(`Verification failed for ${path}`);
    }
  } finally {
    await rm(sourceFile, { force: true });
    await rm(verifyFile, { force: true });
  }
  console.log(`Verified ${path} (${source.length} bytes)`);
}

const workDir = await mkdtemp(join(tmpdir(), "echo-r2-migration-"));
try {
  const paths = await listAll();
  console.log(`Migrating ${paths.length} object(s) from ${sourceBucket} to ${destinationBucket}.`);
  for (const path of paths) await migrateOne(path, workDir);
  if (deleteSource && paths.length > 0) {
    const { error } = await supabase.storage.from(sourceBucket).remove(paths);
    if (error) throw new Error(`R2 copies verified, but source deletion failed: ${error.message}`);
    console.log(`Deleted ${paths.length} verified source object(s) from Supabase Storage.`);
  } else {
    console.log("Copy verification complete. Re-run with --delete-source to remove Supabase source objects.");
  }
} finally {
  await rm(workDir, { recursive: true, force: true });
}
