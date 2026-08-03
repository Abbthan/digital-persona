import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/back_end/services/auth";
import { getDb } from "@/back_end/services/db";
import { closeLiveAvatarSession } from "@/back_end/services/live-avatar";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser().catch(() => null);
  if (!user || !user.emailVerified) {
    return NextResponse.json({ ok: false, error: "You're not logged in." }, { status: 401 });
  }

  const { id: personaId } = await params;
  const body = await request.json().catch(() => null) as { sessionid?: unknown } | null;
  const sessionId = typeof body?.sessionid === "string" ? body.sessionid : "";
  if (!sessionId || sessionId.length > 100) {
    return NextResponse.json({ ok: false, error: "A valid session is required." }, { status: 400 });
  }

  const db = getDb();
  const persona = await db.persona.findFirst({
    where: { id: personaId, userId: user.id },
    select: { id: true },
  });
  if (!persona) {
    return NextResponse.json({ ok: false, error: "Persona not found." }, { status: 404 });
  }

  try {
    await closeLiveAvatarSession({ userId: user.id, personaId, sessionId });
  } catch (error) {
    // Closing is idempotent and best-effort. The GPU also has a connection
    // timeout reaper, so a transient tunnel failure must not keep the browser
    // waiting during navigation/unload.
    console.warn("[live-session] close request failed", { personaId, sessionId, error });
  }
  return NextResponse.json({ ok: true });
}
