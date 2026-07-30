import { NextResponse } from "next/server";
import { getCurrentUser } from "@/back_end/services/auth";
import { getDb } from "@/back_end/services/db";
import { hasPaidAccess } from "@/back_end/services/limits";
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
      /** null until avatar training has completed — the caller falls back to the server's default demo avatar. */
      avatarId: string | null;
      /** null until voice training has completed — the caller falls back to the server's default TTS voice. */
      refAudio: string | null;
      refText: string | null;
      /** null if no TURN relay is configured — the browser's RTCPeerConnection then falls back to STUN-only. */
      turn: { urls: string[]; username: string; credential: string } | null;
    }
  | { ok: false; error: string };

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = getDb();
  const user = await getCurrentUser().catch(() => null);
  if (!user || !user.emailVerified) {
    return NextResponse.json<CreateLiveSessionResponseBody>(
      { ok: false, error: "You're not logged in." },
      { status: 401 },
    );
  }

  if (!hasPaidAccess(user.subscriptionStatus, user.subscriptionRenewsAt)) {
    return NextResponse.json<CreateLiveSessionResponseBody>(
      { ok: false, error: "Real-time voice and video conversation is a subscriber feature." },
      { status: 403 },
    );
  }

  if (!isLiveTalkingConfigured()) {
    return NextResponse.json<CreateLiveSessionResponseBody>(
      { ok: false, error: "The live avatar server isn't configured yet." },
      { status: 503 },
    );
  }

  const { id: personaId } = await params;

  try {
    const persona = await db.persona.findFirst({ where: { id: personaId, userId: user.id } });
    if (!persona) {
      return NextResponse.json<CreateLiveSessionResponseBody>(
        { ok: false, error: "Persona not found." },
        { status: 404 },
      );
    }
    if (persona.status !== "active") {
      return NextResponse.json<CreateLiveSessionResponseBody>(
        { ok: false, error: "This persona is still being prepared." },
        { status: 409 },
      );
    }

    const turn = turnServerConfig();
    console.info("[live-session] configuration issued", {
      personaId,
      userId: user.id,
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
