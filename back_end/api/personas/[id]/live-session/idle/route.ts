import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/back_end/services/auth";
import { getDb } from "@/back_end/services/db";
import { hasPaidAccess } from "@/back_end/services/limits";
import { isLiveTalkingConfigured, setLiveAvatarIdleAction } from "@/back_end/services/live-avatar";

// A small authenticated bridge for LiveTalking's action choreography API.
// The browser never receives the GPU HMAC token or calls the plain-HTTP GPU
// host directly.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser().catch(() => null);
  if (!user || !user.emailVerified) return NextResponse.json({ ok: false, error: "You're not logged in." }, { status: 401 });
  if (!hasPaidAccess(user.subscriptionStatus, user.subscriptionRenewsAt)) {
    return NextResponse.json({ ok: false, error: "Real-time voice and video conversation is a subscriber feature." }, { status: 403 });
  }
  if (!isLiveTalkingConfigured()) return NextResponse.json({ ok: false, error: "The live avatar server isn't configured yet." }, { status: 503 });

  const { id: personaId } = await params;
  const body = await request.json().catch(() => null);
  const sessionId = typeof body?.sessionid === "string" ? body.sessionid.trim() : "";
  const audiotype = body?.audiotype === 0 ? 0 : 0;
  if (!sessionId || sessionId.length > 160) return NextResponse.json({ ok: false, error: "A valid live-session id is required." }, { status: 400 });

  const persona = await getDb().persona.findFirst({ where: { id: personaId, userId: user.id }, select: { id: true, status: true } });
  if (!persona || persona.status !== "active") return NextResponse.json({ ok: false, error: "Persona not found." }, { status: 404 });

  try {
    await setLiveAvatarIdleAction({ userId: user.id, personaId, sessionId, audiotype });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.warn("[live-idle] action request failed", { personaId, error });
    return NextResponse.json({ ok: false, error: "The avatar's idle action is unavailable." }, { status: 502 });
  }
}
