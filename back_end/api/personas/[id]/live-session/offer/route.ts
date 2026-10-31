import { NextRequest, NextResponse } from "next/server";
import { getLiveSessionAccess } from "@/back_end/services/live-session-access";
import {
  createLiveSessionToken,
  isLiveTalkingConfigured,
  liveTalkingServerUrl,
  personaIdleActionConfig,
} from "@/back_end/services/live-avatar";

// Proxies the WebRTC offer/answer handshake through this app's own HTTPS
// origin. The browser can't fetch() LiveTalking's plain-HTTP GPU box
// directly from the HTTPS production site — browsers block that as mixed
// content — so this forwards the SDP offer server-side (no such
// restriction on server-to-server calls) and returns the answer. The
// actual WebRTC media stream still connects browser-to-GPU-box directly
// once negotiated; only this signaling step needed to move server-side.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now();
  const { id: personaId } = await params;
  const access = await getLiveSessionAccess(personaId, { requireAvatar: true });
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const user = { id: access.userId };
  const persona = access.persona;

  if (!isLiveTalkingConfigured()) {
    return NextResponse.json({ ok: false, error: "The live avatar server isn't configured yet." }, { status: 503 });
  }

  if (!persona.liveAvatarId) {
    return NextResponse.json(
      { ok: false, error: "Complete both the guided and passive facial scans to enable live video." },
      { status: 409 },
    );
  }

  const body = await request.json().catch(() => null) as { sdp?: unknown; type?: unknown } | null;
  const sdp = typeof body?.sdp === "string" ? body.sdp : "";
  const type = body?.type === "offer" ? "offer" : "";
  if (!sdp || !type || sdp.length > 200_000) {
    return NextResponse.json({ ok: false, error: "A valid WebRTC offer is required." }, { status: 400 });
  }
  const token = await createLiveSessionToken(user.id, personaId);
  const serverUrl = liveTalkingServerUrl();
  if (!token || !serverUrl) {
    return NextResponse.json({ ok: false, error: "The live avatar server isn't configured yet." }, { status: 503 });
  }

  try {
    const liveOffer = {
      sdp,
      type,
      ...{
        avatar: persona.liveAvatarId,
        // LiveTalking calls `audiotype: 1` for its normal silence state.
        // The configured numbered source frames provide actual natural idle
        // motion instead of repeating a static placeholder frame.
        custom_config: personaIdleActionConfig(persona.liveAvatarId),
      },
      ...(persona.voiceRefTranscript ? {
        refaudio: `data/voice_refs/${personaId}.wav`,
        reftext: persona.voiceRefTranscript,
      } : {}),
    };
    console.info("[live-offer] forwarding", {
      personaId,
      userId: user.id,
      offerBytes: sdp.length,
      hasIdleAction: Boolean(persona.liveAvatarId),
    });
    const response = await fetch(`${serverUrl}/offer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(liveOffer),
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
