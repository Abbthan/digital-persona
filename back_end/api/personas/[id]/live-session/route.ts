import { NextResponse } from "next/server";
import { getLiveSessionAccess } from "@/back_end/services/live-session-access";
import { isLiveTalkingConfigured, turnServerConfig } from "@/back_end/services/live-avatar";
import { voiceRefPath } from "@/back_end/services/speech";

// No token/serverUrl here anymore — the browser used to fetch() LiveTalking
// directly with those, but that's a plain-HTTP GPU box being called from an
// HTTPS page, which browsers block as mixed content. The actual signaling
// calls (/offer, /human) now go through this app's own HTTPS routes
// (live-session/offer, live-session/human), which mint their own token
// server-side — see those routes for why.
export type CreateLiveSessionResponseBody =
  | {
      ok: true;
      avatarId: string;
      /** null until voice training has completed — the caller falls back to the server's default TTS voice. */
      refAudio: string | null;
      refText: string | null;
      /** null if no TURN relay is configured — the browser's RTCPeerConnection then falls back to STUN-only. */
      turn: { urls: string[]; username: string; credential: string } | null;
    }
  | { ok: false; error: string };

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: personaId } = await params;
  const access = await getLiveSessionAccess(personaId, { requireAvatar: true });
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });

  if (!isLiveTalkingConfigured()) {
    return NextResponse.json<CreateLiveSessionResponseBody>(
      { ok: false, error: "The live avatar server isn't configured yet." },
      { status: 503 },
    );
  }

  try {
    const persona = access.persona;
    if (!persona.liveAvatarId) {
      return NextResponse.json<CreateLiveSessionResponseBody>(
        { ok: false, error: "Complete both the guided and passive facial scans to enable live video." },
        { status: 409 },
      );
    }

    const turn = turnServerConfig();
    console.info("[live-session] configuration issued", {
      personaId,
      userId: access.userId,
      personaStatus: persona.status,
      hasAvatar: Boolean(persona.liveAvatarId),
      hasVoiceReference: Boolean(persona.voiceRefTranscript),
      hasTurn: Boolean(turn),
    });
    return NextResponse.json<CreateLiveSessionResponseBody>({
      ok: true,
      avatarId: persona.liveAvatarId,
      refAudio: persona.voiceRefTranscript ? voiceRefPath(personaId) : null,
      refText: persona.voiceRefTranscript,
      turn: turn ? { urls: turn.urls, username: turn.username, credential: turn.credential } : null,
    });
  } catch (error) {
    console.error("POST /api/personas/[id]/live-session failed", error);
    return NextResponse.json<CreateLiveSessionResponseBody>(
      { ok: false, error: "Couldn't start a live session — the database isn't reachable yet." },
      { status: 500 },
    );
  }
}
