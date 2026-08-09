import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/back_end/services/db";
import { getPersonaReply } from "@/back_end/services/persona-ai";
import { composePersonaPrompt } from "@/back_end/services/persona-rag";

/**
 * Temporary diagnostic route: verifies the newly-configured LLM
 * provider (OPENAI_API_KEY/OPENAI_API_BASE_URL/OPENAI_MODEL) works
 * end-to-end, including RAG/memory context retrieval, without needing a
 * real browser session. Removed once verified.
 */
const DEBUG_SECRET = "vT3nB7qL5xW9cR2mK8pZ4fH6yU0aD1gS";
const PERSONA_ID = "cmsjqcvp60002psp73uk39ks9";

export async function GET(request: NextRequest) {
  if (request.headers.get("x-debug-secret") !== DEBUG_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const persona = await db.persona.findUnique({
    where: { id: PERSONA_ID },
    select: { id: true, name: true, voiceRefTranscript: true },
  });
  if (!persona) return NextResponse.json({ ok: false, error: "persona not found" }, { status: 404 });

  const testMessage = "What do you remember about the video and audio you recorded for training your avatar?";

  const [reply, retrieved] = await Promise.all([
    getPersonaReply({
      personaId: persona.id,
      personaName: persona.name,
      message: testMessage,
      locale: "en",
      recentMessages: [],
      voiceReferenceTranscript: persona.voiceRefTranscript,
    }),
    composePersonaPrompt(persona.id, persona.name, testMessage, 8),
  ]);

  return NextResponse.json({
    ok: true,
    testMessage,
    reply,
    retrievedContextPreview: retrieved?.prompt ? retrieved.prompt.slice(0, 800) : null,
    retrievedSourceCounts: retrieved
      ? {
        conversation: retrieved.sources.conversation.length,
        documents: retrieved.sources.documents.length,
        document_images: retrieved.sources.document_images.length,
      }
      : null,
  });
}
