import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/back_end/services/auth";
import { getDb } from "@/back_end/services/db";
import { getPersonaReply, type PersonaConversationTurn } from "@/back_end/services/persona-ai";
import { incrementPlatformMetrics } from "@/back_end/services/metrics";
import { ingestConversationMessage } from "@/back_end/services/persona-rag";
import { maskInappropriateLanguage } from "@/back_end/services/moderation";
import { dispatchLiveSpeech, isLiveTalkingConfigured } from "@/back_end/services/livetalking";
import { hasPaidAccess } from "@/back_end/services/limits";

export type ChatMessageDTO = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
};

export type GetMessagesResponseBody =
  | { ok: true; messages: ChatMessageDTO[] }
  | { ok: false; error: string };

export type SendMessageResponseBody =
  | { ok: true; userMessage: ChatMessageDTO; replyMessage: ChatMessageDTO; liveSpeechQueued: boolean }
  | { ok: false; error: string };

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const db = getDb();
  const user = await getCurrentUser().catch(() => null);
  if (!user || !user.emailVerified) {
    return NextResponse.json<GetMessagesResponseBody>(
      { ok: false, error: "You're not logged in." },
      { status: 401 },
    );
  }

  const { id: personaId } = await params;

  try {
    const persona = await db.persona.findFirst({ where: { id: personaId, userId: user.id } });
    if (!persona) {
      return NextResponse.json<GetMessagesResponseBody>(
        { ok: false, error: "Persona not found." },
        { status: 404 },
      );
    }
    if (persona.status !== "active") {
      return NextResponse.json<GetMessagesResponseBody>(
        { ok: false, error: "This persona is still being prepared." },
        { status: 409 },
      );
    }

    const messages = await db.chatMessage.findMany({
      where: { personaId },
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true, content: true, createdAt: true },
    });

    return NextResponse.json<GetMessagesResponseBody>({
      ok: true,
      messages: messages.map((message) => ({
        ...message,
        createdAt: message.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("GET /api/personas/[id]/messages failed", error);
    return NextResponse.json<GetMessagesResponseBody>(
      { ok: false, error: "Couldn't load messages — the database isn't reachable yet." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const db = getDb();
  const user = await getCurrentUser().catch(() => null);
  if (!user || !user.emailVerified) {
    return NextResponse.json<SendMessageResponseBody>(
      { ok: false, error: "You're not logged in." },
      { status: 401 },
    );
  }

  const { id: personaId } = await params;
  const body = await request.json().catch(() => null);
  const content = typeof body?.content === "string" ? maskInappropriateLanguage(body.content.trim()) : "";
  // A session id is only useful while the subscriber has an already-open
  // WebRTC session. The short length cap prevents this background path from
  // becoming a vehicle for arbitrary oversized payloads.
  const liveSessionId = typeof body?.liveSessionId === "string" && body.liveSessionId.length <= 160
    ? body.liveSessionId.trim()
    : "";
  const requestedLocale = body?.locale === "zh" ? "zh" : "en";

  if (!content) {
    return NextResponse.json<SendMessageResponseBody>(
      { ok: false, error: "Message can't be empty." },
      { status: 400 },
    );
  }

  try {
    const persona = await db.persona.findFirst({ where: { id: personaId, userId: user.id } });
    if (!persona) {
      return NextResponse.json<SendMessageResponseBody>(
        { ok: false, error: "Persona not found." },
        { status: 404 },
      );
    }
    if (persona.status !== "active") {
      return NextResponse.json<SendMessageResponseBody>(
        { ok: false, error: "This persona is still being prepared." },
        { status: 409 },
      );
    }

    const userMessage = await db.chatMessage.create({
      data: { personaId, role: "user", content },
      select: { id: true, role: true, content: true, createdAt: true },
    });

    const recentRows = await db.chatMessage.findMany({
      where: { personaId },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { role: true, content: true },
    });
    const recentMessages: PersonaConversationTurn[] = [];
    for (const message of recentRows.reverse()) {
      if (message.role === "user") recentMessages.push({ role: "user", content: message.content });
      if (message.role === "persona") recentMessages.push({ role: "persona", content: message.content });
    }

    const replyContent = maskInappropriateLanguage(await getPersonaReply({
      personaId,
      personaName: persona.name,
      message: content,
      locale: requestedLocale,
      recentMessages,
      voiceReferenceTranscript: persona.voiceRefTranscript,
    }));

    const replyMessage = await db.chatMessage.create({
      data: { personaId, role: "persona", content: replyContent },
      select: { id: true, role: true, content: true, createdAt: true },
    });

    // Persist both real turns after the visible response is returned. RAG
    // ingestion is intentionally outside the critical path: the current
    // turn is already in the model input, while a transient vector-service
    // outage must not make chat unavailable.
    after(async () => {
      await Promise.all([
        ingestConversationMessage(personaId, userMessage.id, "user", content),
        ingestConversationMessage(personaId, replyMessage.id, "persona", replyContent),
      ].map((task) => task.catch((ragError) => {
        console.error("Background conversation-memory ingestion failed", ragError);
      })));
    });

    await incrementPlatformMetrics({ messagesExchanged: 2 }).catch((metricError) => {
      console.error("Chat metric increment failed", metricError);
    });

    // Start the avatar request as soon as the reply is known, rather than
    // returning it to the browser and waiting for a second client-side HTTP
    // request. `after()` is backed by Cloudflare's waitUntil in this OpenNext
    // deployment, so the response remains fast while the Worker is kept alive
    // for the short server-to-server enqueue request. If no live session is
    // available, the client retains its existing on-connect fallback.
    const liveSpeechQueued = Boolean(
      liveSessionId &&
      isLiveTalkingConfigured() &&
      hasPaidAccess(user.subscriptionStatus, user.subscriptionRenewsAt),
    );
    if (liveSpeechQueued) {
      after(async () => {
        try {
          await dispatchLiveSpeech({
            userId: user.id,
            personaId,
            sessionId: liveSessionId,
            text: replyContent,
          });
        } catch (liveError) {
          // Text chat remains successful if the optional live service is down.
          // The error is logged server-side without disclosing infrastructure
          // details to the user.
          console.error("Background live-speech dispatch failed", liveError);
        }
      });
    }

    return NextResponse.json<SendMessageResponseBody>({
      ok: true,
      userMessage: { ...userMessage, createdAt: userMessage.createdAt.toISOString() },
      replyMessage: { ...replyMessage, createdAt: replyMessage.createdAt.toISOString() },
      liveSpeechQueued,
    });
  } catch (error) {
    console.error("POST /api/personas/[id]/messages failed", error);
    return NextResponse.json<SendMessageResponseBody>(
      { ok: false, error: "Couldn't send — the database isn't reachable yet." },
      { status: 500 },
    );
  }
}
