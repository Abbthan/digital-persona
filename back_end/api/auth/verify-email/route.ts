import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/back_end/services/db";
import { getSession } from "@/back_end/services/session";
import { normalizeVerificationCode, verificationCodesMatch, VERIFICATION_CODE_LENGTH } from "@/back_end/services/verification";

export type VerifyEmailResponseBody = { ok: true } | { ok: false; error: string };

export async function POST(request: NextRequest) {
  const db = getDb();
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const code = typeof body?.code === "string" ? normalizeVerificationCode(body.code) : "";

  if (!email || !new RegExp(`^[A-Z0-9]{${VERIFICATION_CODE_LENGTH}}$`).test(code)) {
    return NextResponse.json<VerifyEmailResponseBody>(
      { ok: false, error: "Enter the 6-character confirmation code." },
      { status: 400 },
    );
  }

  try {
    const pending = await db.pendingRegistration.findUnique({ where: { email } });
    if (!pending || pending.expiresAt < new Date()) {
      if (pending) await db.pendingRegistration.delete({ where: { id: pending.id } });
      return NextResponse.json<VerifyEmailResponseBody>(
        { ok: false, error: "That code is invalid or expired. Please register again." },
        { status: 400 },
      );
    }
    if (!verificationCodesMatch(code, pending.verificationCodeHash)) {
      return NextResponse.json<VerifyEmailResponseBody>(
        { ok: false, error: "That confirmation code isn't correct." },
        { status: 400 },
      );
    }

    const user = await db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username: pending.username,
          email: pending.email,
          passwordHash: pending.passwordHash,
          emailVerified: true,
        },
      });
      await tx.pendingRegistration.delete({ where: { id: pending.id } });
      return created;
    });

    const session = await getSession();
    session.userId = user.id;
    await session.save();

    return NextResponse.json<VerifyEmailResponseBody>({ ok: true });
  } catch (error) {
    console.error("POST /api/auth/verify-email failed", error);
    return NextResponse.json<VerifyEmailResponseBody>(
      { ok: false, error: "We couldn't complete your confirmation. Please try again." },
      { status: 500 },
    );
  }
}
