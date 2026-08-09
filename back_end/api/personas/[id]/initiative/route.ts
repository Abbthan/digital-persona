import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/back_end/services/auth";
import { getDb } from "@/back_end/services/db";
import { hasPaidAccess } from "@/back_end/services/limits";
import { incrementPlatformMetrics } from "@/back_end/services/metrics";
import { maskInappropriateLanguage } from "@/back_end/services/moderation";
import { getPersonaInitiative, type PersonaConversationTurn } from "@/back_end/services/persona-ai";
import { ingestConversationMessage } from "@/back_end/services/persona-rag";
import { isLiveTalkingConfigured } from "@/back_end/services/live-avatar";
import { dispatchLiveSpeech } from "@/back_end/services/speech";

const MIN_IDLE_MS = 6 * 60 * 1_000;
const INITIATIVE_WINDOW_MS = 6 * 60 * 1_000;

export type PersonaInitiativeResponseBody =
  | { ok: true; message: { id: string; role: string; content: string; createdAt: string } | null; liveSpeechQueued: boolean }
  | { ok: false; error: string };

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// Two quiet windows out of three intentionally produce nothing. This makes
// a persona feel considerate rather than like an alert system, while still
// letting a grounded thought surface eventually during an open conversation.
function initiativeIsDue(personaId: string, latestMessageId: string, now: number): boolean {
  const window = Math.floor(now / INITIATIVE_WINDOW_MS);
  return stableHash(`${personaId}:${latestMessageId}:${window}`) % 3 === 0;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const db = getDb();
  const user = await getCurrentUser().catch(() => null);
  if (!user || !user.emailVerified) {
    return NextResponse.json<PersonaInitiativeResponseBody>({ ok: false, error: "You're not logged in." }, { status: 401 });
  }

  const { id: personaId } = await params;
  const body = await request.json().catch(() => null);
  const locale = body?.locale === "zh" ? "zh" : "en";
  const liveSessionId = typeof body?.liveSessionId === "string" && body.liveSessionId.length <= 160
    ? body.liveSessionId.trim()
    : "";

  try {
    const persona = await db.persona.findFirst({
      where: { id: personaId, userId: user.id, status: "active" },
      select: { id: true, name: true, voiceRefTranscript: true },
    });
    if (!persona) {
      return NextResponse.json<PersonaInitiativeResponseBody>({ ok: false, error: "Persona not found." }, { status: 404 });
    }

    const latest = await db.chatMessage.findFirst({
      where: { personaId },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true },
    });
    const now = Date.now();
    if (!latest || now - latest.createdAt.getTime() < MIN_IDLE_MS || !initiativeIsDue(personaId, latest.id, now)) {
      return NextResponse.json<PersonaInitiativeResponseBody>({ ok: true, message: null, liveSpeechQueued: false });
    }

    const rows = await db.chatMessage.findMany({
      where: { personaId },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { role: true, content: true },
    });
    const recentMessages: PersonaConversationTurn[] = [];
    for (const message of rows.reverse()) {
      if (message.role === "user") recentMessages.push({ role: "user", content: message.content });
      if (message.role === "persona") recentMessages.push({ role: "persona", content: message.content });
    }
    if (!recentMessages.some((message) => message.role === "user")) {
      return NextResponse.json<PersonaInitiativeResponseBody>({ ok: true, message: null, liveSpeechQueued: false });
    }

    const content = maskInappropriateLanguage(await getPersonaInitiative({
      personaId,
      personaName: persona.name,
      locale,
      recentMessages,
      voiceReferenceTranscript: persona.voiceRefTranscript,
    }) ?? "");
    if (!content) {
      return NextResponse.json<PersonaInitiativeResponseBody>({ ok: true, message: null, liveSpeechQueued: false });
    }

    // A user may have sent a message while model generation was underway.
    // Do not insert an unsolicited thought into a now-active conversation.
    const currentLatest = await db.chatMessage.findFirst({
      where: { personaId }, orderBy: { createdAt: "desc" }, select: { id: true },
    });
    if (currentLatest?.id !== latest.id) {
      return NextResponse.json<PersonaInitiativeResponseBody>({ ok: true, message: null, liveSpeechQueued: false });
    }

    const message = await db.chatMessage.create({
      data: { personaId, role: "persona", content },
      select: { id: true, role: true, content: true, createdAt: true },
    });
    let liveSpeechQueued = false;
    if (liveSessionId && isLiveTalkingConfigured() && hasPaidAccess(user.subscriptionStatus, user.subscriptionRenewsAt)) {
      try {
        await dispatchLiveSpeech({
          userId: user.id,
          personaId,
          sessionId: liveSessionId,
          utteranceId: message.id,
          text: content,
        });
        liveSpeechQueued = true;
      } catch (error) {
        // The text opening is still useful if the optional avatar service is
        // unavailable. Returning false preserves the browser fallback.
        console.error("[persona-initiative] live speech dispatch failed", { personaId, error });
      }
    }
    after(async () => {
      await Promise.all([
        ingestConversationMessage(personaId, message.id, "persona", content),
        incrementPlatformMetrics({ messagesExchanged: 1 }),
      ].map((task) => task.catch((error) => console.error("[persona-initiative] background task failed", { personaId, error }))));
    });

    return NextResponse.json<PersonaInitiativeResponseBody>({
      ok: true,
      message: { ...message, createdAt: message.createdAt.toISOString() },
      liveSpeechQueued,
    });
  } catch (error) {
    console.error("POST /api/personas/[id]/initiative failed", { personaId, error });
    return NextResponse.json<PersonaInitiativeResponseBody>({ ok: false, error: "Couldn't create a conversation starter." }, { status: 500 });
  }
}
