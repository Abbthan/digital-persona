import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/back_end/services/auth";
import { getDb } from "@/back_end/services/db";
import { hasPaidAccess } from "@/back_end/services/limits";
import { isLiveTalkingConfigured } from "@/back_end/services/live-avatar";
import { dispatchLiveSpeech } from "@/back_end/services/speech";

// Proxies "make the avatar speak this text" the same way /offer above does
// — same mixed-content reason, browser can't fetch() the plain-HTTP GPU
// box directly from the HTTPS site.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const db = getDb();
  const user = await getCurrentUser().catch(() => null);
  if (!user || !user.emailVerified) {
    return NextResponse.json({ ok: false, error: "You're not logged in." }, { status: 401 });
  }

  if (!hasPaidAccess(user.subscriptionStatus, user.subscriptionRenewsAt)) {
    return NextResponse.json(
      { ok: false, error: "Real-time voice and video conversation is a subscriber feature." },
      { status: 403 },
    );
  }

  if (!isLiveTalkingConfigured()) {
    return NextResponse.json({ ok: false, error: "The live avatar server isn't configured yet." }, { status: 503 });
  }

  const { id: personaId } = await params;

  const persona = await db.persona.findFirst({ where: { id: personaId, userId: user.id } });
  if (!persona || persona.status !== "active") {
    return NextResponse.json({ ok: false, error: "Persona not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const sessionId = typeof body?.sessionid === "string" ? body.sessionid.trim() : "";
  const utteranceId = typeof body?.utteranceId === "string" && body.utteranceId.length <= 160
    ? body.utteranceId.trim()
    : "";
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!sessionId || !utteranceId || !text) {
    return NextResponse.json(
      { ok: false, error: "A live-session id, utterance id, and message are required." },
      { status: 400 },
    );
  }

  try {
    await dispatchLiveSpeech({ userId: user.id, personaId, sessionId, utteranceId, text });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Couldn't reach the avatar server." }, { status: 502 });
  }
}
