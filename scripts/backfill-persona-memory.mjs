/*
 * Re-ingests existing persona source material after an extraction/OCR change.
 * It never reads media into this process: agentic-memory pulls each private
 * object through the existing persona-scoped HMAC media endpoint, keeping
 * large files and owner data out of the local/Worker heap.
 *
 * Run: node --env-file=.env scripts/backfill-persona-memory.mjs
 */
import { createHmac } from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
const memoryUrl = process.env.LIVETALKING_SERVER_URL?.replace(/\/+$/, "");
const secret = process.env.LIVETALKING_SESSION_SECRET;
const appOrigin = (process.env.PUBLIC_APP_ORIGIN || "https://echodigitalpersona.com").replace(/\/+$/, "");

if (!databaseUrl || !memoryUrl || !secret) {
  throw new Error("DATABASE_URL, LIVETALKING_SERVER_URL, and LIVETALKING_SESSION_SECRET are required.");
}

function token(personaId) {
  const payload = Buffer.from(JSON.stringify({
    uid: "system",
    pid: personaId,
    exp: Math.floor(Date.now() / 1000) + 600,
  })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

function originalName(asset) {
  const metadata = asset.metadata && typeof asset.metadata === "object" ? asset.metadata : {};
  return typeof metadata.originalName === "string" && metadata.originalName
    ? metadata.originalName
    : asset.url.split("/").pop() || `${asset.id}.${asset.type === "image" ? "png" : "txt"}`;
}

async function post(path, personaId, body) {
  const response = await fetch(`${memoryUrl}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token(personaId)}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) {
    throw new Error(`${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return response.json();
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
let failed = 0;
try {
  const { rows: assets } = await pool.query(`
    SELECT id, "personaId", type, url, metadata
    FROM "PersonaAsset"
    WHERE type IN ('text'::"AssetType", 'image'::"AssetType")
    ORDER BY "createdAt" ASC
  `);
  for (const asset of assets) {
    try {
      const fileName = originalName(asset);
      const result = await post("/api/rag/ingest/document-from-url", asset.personaId, {
        persona_id: asset.personaId,
        asset_id: asset.id,
        file_name: fileName,
        source_url: `${appOrigin}/api/internal/persona-media/${encodeURIComponent(asset.personaId)}/${encodeURIComponent(asset.id)}`,
      });
      console.log(`Re-ingested ${asset.type} ${asset.id}: ${result.text_chunks ?? 0} text, ${result.image_ocr_chunks ?? 0} OCR chunk(s)`);
    } catch (error) {
      failed += 1;
      console.error(`Failed ${asset.type} ${asset.id}:`, error instanceof Error ? error.message : error);
    }
  }

  const { rows: voices } = await pool.query(`
    SELECT id, "voiceRefAssetId", "voiceRefTranscript"
    FROM "Persona"
    WHERE "voiceRefAssetId" IS NOT NULL
      AND "voiceRefTranscript" IS NOT NULL
      AND length(trim("voiceRefTranscript")) > 0
  `);
  for (const persona of voices) {
    try {
      await post("/api/rag/ingest/conversation", persona.id, {
        persona_id: persona.id,
        message_id: persona.voiceRefAssetId,
        role: "source",
        content: persona.voiceRefTranscript,
        created_at: new Date().toISOString(),
      });
      console.log(`Re-ingested source voice transcript for ${persona.id}`);
    } catch (error) {
      failed += 1;
      console.error(`Failed voice transcript ${persona.id}:`, error instanceof Error ? error.message : error);
    }
  }
} finally {
  await pool.end();
}

if (failed > 0) throw new Error(`Memory backfill completed with ${failed} failure(s).`);
