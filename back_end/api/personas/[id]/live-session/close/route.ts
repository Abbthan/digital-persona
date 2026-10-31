import { NextRequest, NextResponse } from "next/server";
import { getLiveSessionAccess } from "@/back_end/services/live-session-access";
import { closeLiveAvatarSession } from "@/back_end/services/live-avatar";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: personaId } = await params;
  // Owners must still be able to release a session after a subscription
  // expires or training changes the persona's state.
  const access = await getLiveSessionAccess(personaId, { requirePaid: false, requireActive: false });
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const body = await request.json().catch(() => null) as { sessionid?: unknown } | null;
  const sessionId = typeof body?.sessionid === "string" ? body.sessionid : "";
  if (!sessionId || sessionId.length > 100) {
    return NextResponse.json({ ok: false, error: "A valid session is required." }, { status: 400 });
  }

  try {
    await closeLiveAvatarSession({ userId: access.userId, personaId, sessionId });
  } catch (error) {
    // Closing is idempotent and best-effort. The GPU also has a connection
    // timeout reaper, so a transient tunnel failure must not keep the browser
    // waiting during navigation/unload.
    console.warn("[live-session] close request failed", { personaId, sessionId, error });
  }
  return NextResponse.json({ ok: true });
}
