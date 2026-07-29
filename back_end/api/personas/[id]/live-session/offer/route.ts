import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/back_end/services/auth";
import { getDb } from "@/back_end/services/db";
import { hasPaidAccess } from "@/back_end/services/limits";
import { createLiveSessionToken, isLiveTalkingConfigured, liveTalkingServerUrl } from "@/back_end/services/livetalking";

// Proxies the WebRTC offer/answer handshake through this app's own HTTPS
// origin. The browser can't fetch() LiveTalking's plain-HTTP GPU box
// directly from the HTTPS production site — browsers block that as mixed
// content — so this forwards the SDP offer server-side (no such
// restriction on server-to-server calls) and returns the answer. The
// actual WebRTC media stream still connects browser-to-GPU-box directly
// once negotiated; only this signaling step needed to move server-side.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now();
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

  const body = await request.text();
  const token = await createLiveSessionToken(user.id, personaId);
  const serverUrl = liveTalkingServerUrl();
  if (!token || !serverUrl) {
    return NextResponse.json({ ok: false, error: "The live avatar server isn't configured yet." }, { status: 503 });
  }

  try {
    console.info("[live-offer] forwarding", { personaId, userId: user.id, offerBytes: body.length });
    const response = await fetch(`${serverUrl}/offer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body,
    });
    const responseBody = await response.text();
    console.info("[live-offer] response", {
      personaId,
      status: response.status,
      answerBytes: responseBody.length,
      durationMs: Date.now() - startedAt,
    });
    return new NextResponse(responseBody, { status: response.status, headers: { "Content-Type": "application/json" } });
  } catch (error) {
    console.error("[live-offer] gateway failure", { personaId, durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ ok: false, error: "Couldn't reach the avatar server." }, { status: 502 });
  }
}
