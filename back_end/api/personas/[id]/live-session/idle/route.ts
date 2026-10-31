import { NextRequest, NextResponse } from "next/server";
import { getLiveSessionAccess } from "@/back_end/services/live-session-access";
import { isLiveTalkingConfigured, setLiveAvatarIdleAction } from "@/back_end/services/live-avatar";

// A small authenticated bridge for LiveTalking's action choreography API.
// The browser never receives the GPU HMAC token or calls the plain-HTTP GPU
// host directly.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: personaId } = await params;
  const access = await getLiveSessionAccess(personaId);
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  if (!isLiveTalkingConfigured()) return NextResponse.json({ ok: false, error: "The live avatar server isn't configured yet." }, { status: 503 });

  const body = await request.json().catch(() => null);
  const sessionId = typeof body?.sessionid === "string" ? body.sessionid.trim() : "";
  // Type 1 is LiveTalking's silence state. The offer route registers the
  // persona's original numbered motion frames for exactly this action, so
  // explicitly selecting it after signaling avoids falling back to its
  // static default frame.
  const audiotype = 1 as const;
  if (!sessionId || sessionId.length > 160) return NextResponse.json({ ok: false, error: "A valid live-session id is required." }, { status: 400 });

  try {
    await setLiveAvatarIdleAction({ userId: access.userId, personaId, sessionId, audiotype });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.warn("[live-idle] action request failed", { personaId, error });
    return NextResponse.json({ ok: false, error: "The avatar's idle action is unavailable." }, { status: 502 });
  }
}
