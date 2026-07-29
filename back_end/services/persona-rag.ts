// Bridges this app's backend to the standalone persona-rag FastAPI service
// on the GPU box — a vector store + document/conversation ingestion
// pipeline that lets a persona "remember" its uploaded documents and past
// conversations, ready for an LLM to draw on once one is wired up (see
// docs/persona-rag.md). Reuses livetalking.ts's signed-token scheme and is
// reached the same way: proxied through LiveTalking's app.py, which is the
// only externally reachable port on the box.
//
// This module only retrieves and ingests scoped memory. Model inference lives
// in persona-ai.ts, so heavy extraction/embedding stays on the GPU backend
// and private source files never enter the Worker heap.

import { createLiveSessionToken, liveTalkingServerUrl } from "@/back_end/services/livetalking";

async function systemToken(personaId: string): Promise<string | null> {
  return createLiveSessionToken("system", personaId);
}

function privatePersonaMediaUrl(personaId: string, assetId: string): string {
  const origin = process.env.PUBLIC_APP_ORIGIN ?? "https://echodigitalpersona.com";
  return `${origin}/api/internal/persona-media/${encodeURIComponent(personaId)}/${encodeURIComponent(assetId)}`;
}

/**
 * Extracts text (and OCRs any embedded images) from an uploaded document
 * and embeds it into the persona's vector store. Re-ingesting the same
 * assetId replaces its prior chunks rather than duplicating them.
 */
export async function ingestDocument(personaId: string, assetId: string, fileName: string): Promise<boolean> {
  const serverUrl = liveTalkingServerUrl();
  const token = await systemToken(personaId);
  if (!serverUrl || !token) return false;

  try {
    // The RAG service receives only a private, HMAC-protected source URL and
    // pulls the file itself. This keeps extraction/OCR and document bytes off
    // the Worker heap.
    const response = await fetch(`${serverUrl}/api/rag/ingest/document-from-url`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        persona_id: personaId,
        asset_id: assetId,
        file_name: fileName,
        source_url: privatePersonaMediaUrl(personaId, assetId),
      }),
      signal: AbortSignal.timeout(12_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Embeds one chat turn into the persona's memory. Both human and real persona
 * turns can be safely stored; source IDs are exact so a later delete removes
 * only that turn.
 */
export async function ingestConversationMessage(
  personaId: string,
  messageId: string,
  role: string,
  content: string,
): Promise<boolean> {
  const serverUrl = liveTalkingServerUrl();
  const token = await systemToken(personaId);
  if (!serverUrl || !token) return false;

  try {
    const response = await fetch(`${serverUrl}/api/rag/ingest/conversation`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        persona_id: personaId,
        message_id: messageId,
        role,
        content,
        created_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(8_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Real, exact deletion (not a full-retrain approximation) — removes exactly the chunks tied to one asset or message. */
export async function deleteRagSource(personaId: string, sourceId: string): Promise<boolean> {
  const serverUrl = liveTalkingServerUrl();
  const token = await systemToken(personaId);
  if (!serverUrl || !token) return false;

  try {
    const response = await fetch(`${serverUrl}/api/rag/source/${personaId}/${sourceId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    });
    return response.ok;
  } catch {
    // A slow/unreachable GPU box shouldn't be able to hang or fail the
    // asset delete this is called from.
    return false;
  }
}

/** Wipes everything ingested for a persona — call when the persona itself is deleted. */
export async function deleteAllRagData(personaId: string): Promise<boolean> {
  const serverUrl = liveTalkingServerUrl();
  const token = await systemToken(personaId);
  if (!serverUrl || !token) return false;

  try {
    const response = await fetch(`${serverUrl}/api/rag/persona/${personaId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export type RagHit = {
  text: string;
  distance: number;
  metadata: Record<string, unknown>;
};

export type ComposedPersonaPrompt = {
  prompt: string;
  sources: { conversation: RagHit[]; documents: RagHit[]; document_images: RagHit[] };
};

/**
 * Retrieves the most relevant memories/documents for a query and assembles
 * them into a system+context+query prompt string. Nothing in this service
 * calls an LLM; persona-ai.ts consumes the bounded result separately.
 */
export async function composePersonaPrompt(
  personaId: string,
  personaName: string,
  query: string,
  topK = 6,
): Promise<ComposedPersonaPrompt | null> {
  const serverUrl = liveTalkingServerUrl();
  const token = await systemToken(personaId);
  if (!serverUrl || !token) return null;

  try {
    const response = await fetch(`${serverUrl}/api/rag/compose-prompt`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ persona_id: personaId, persona_name: personaName, query: query.slice(0, 2_000), top_k: Math.min(Math.max(topK, 1), 8) }),
      signal: AbortSignal.timeout(8_000),
    });
    const body = (await response.json()) as { ok: boolean; prompt: string; sources: ComposedPersonaPrompt["sources"] };
    if (!response.ok || !body.ok) return null;
    return { prompt: body.prompt, sources: body.sources };
  } catch {
    return null;
  }
}
