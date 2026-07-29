import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/back_end/services/db";
import { getSession } from "@/back_end/services/session";
import { normalizeVerificationCode, verificationCodesMatch, VERIFICATION_CODE_LENGTH } from "@/back_end/services/verification";

export type VerifyPasswordChangeResponseBody = { ok: true } | { ok: false; error: string };

export async function POST(request: NextRequest) {
  const db = getDb();
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json<VerifyPasswordChangeResponseBody>(
      { ok: false, error: "You're not logged in." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? normalizeVerificationCode(body.code) : "";

  if (!new RegExp(`^[A-Z0-9]{${VERIFICATION_CODE_LENGTH}}$`).test(code)) {
    return NextResponse.json<VerifyPasswordChangeResponseBody>(
      { ok: false, error: "Enter the 6-character confirmation code." },
      { status: 400 },
    );
  }

  try {
    const pending = await db.pendingPasswordChange.findUnique({ where: { userId: session.userId } });
    if (!pending || pending.expiresAt < new Date()) {
      if (pending) await db.pendingPasswordChange.delete({ where: { id: pending.id } });
      return NextResponse.json<VerifyPasswordChangeResponseBody>(
        { ok: false, error: "That code is invalid or expired. Please request a new one." },
        { status: 400 },
      );
    }
    if (!verificationCodesMatch(code, pending.verificationCodeHash)) {
      return NextResponse.json<VerifyPasswordChangeResponseBody>(
        { ok: false, error: "That confirmation code isn't correct." },
        { status: 400 },
      );
    }

    await db.$transaction([
      db.user.update({ where: { id: session.userId }, data: { passwordHash: pending.newPasswordHash } }),
      db.pendingPasswordChange.delete({ where: { id: pending.id } }),
    ]);

    return NextResponse.json<VerifyPasswordChangeResponseBody>({ ok: true });
  } catch (error) {
    console.error("POST /api/account/password/verify failed", error);
    return NextResponse.json<VerifyPasswordChangeResponseBody>(
      { ok: false, error: "We couldn't complete your password change. Please try again." },
      { status: 500 },
    );
  }
}
