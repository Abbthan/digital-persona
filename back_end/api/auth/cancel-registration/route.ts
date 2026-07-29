import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/back_end/services/db";
import { registrationCancellationTokensMatch } from "@/back_end/services/verification";

type CancelRegistrationBody = { email?: unknown; username?: unknown; cancellationToken?: unknown };

async function readBody(request: NextRequest): Promise<CancelRegistrationBody | null> {
  const text = await request.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text) as CancelRegistrationBody;
  } catch {
    return null;
  }
}

/**
 * A pending registration owns only a temporary reservation. The random token
 * returned by /register lets the originating browser release that reservation
 * on modal dismissal, refresh, or page close without exposing a cancellation
 * primitive to other browsers.
 */
export async function POST(request: NextRequest) {
  const body = await readBody(request);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const cancellationToken = typeof body?.cancellationToken === "string" ? body.cancellationToken : "";
  if (!email || !username || !cancellationToken) return new NextResponse(null, { status: 204 });

  try {
    const db = getDb();
    const pending = await db.pendingRegistration.findUnique({ where: { email } });
    if (
      pending &&
      pending.username === username &&
      registrationCancellationTokensMatch(cancellationToken, pending.cancellationTokenHash)
    ) {
      await db.pendingRegistration.delete({ where: { id: pending.id } });
    }
  } catch (error) {
    console.error("POST /api/auth/cancel-registration failed", error);
  }

  return NextResponse.json({ ok: true });
}
