import { NextRequest, NextResponse } from "next/server";
import { getLiveSessionAccess } from "@/back_end/services/live-session-access";
import { isLiveTalkingConfigured } from "@/back_end/services/live-avatar";
import { dispatchLiveSpeech } from "@/back_end/services/speech";

// Proxies "make the avatar speak this text" the same way /offer above does
// — same mixed-content reason, browser can't fetch() the plain-HTTP GPU
// box directly from the HTTPS site.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: personaId } = await params;
  const access = await getLiveSessionAccess(personaId);
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });

  if (!isLiveTalkingConfigured()) {
    return NextResponse.json({ ok: false, error: "The live avatar server isn't configured yet." }, { status: 503 });
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
    await dispatchLiveSpeech({ userId: access.userId, personaId, sessionId, utteranceId, text });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Couldn't reach the avatar server." }, { status: 502 });
  }
}
