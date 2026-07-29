import { NextRequest, NextResponse } from "next/server";
import { hashPassword, validatePassword, verifyPassword } from "@/back_end/services/auth";
import { getDb } from "@/back_end/services/db";
import { isEmailDeliveryConfigured, sendPasswordChangeConfirmationEmail } from "@/back_end/services/email";
import { getSession } from "@/back_end/services/session";
import {
  generateVerificationCode,
  hashVerificationCode,
  secondsUntil,
  VERIFICATION_CODE_TTL_MINUTES,
  VERIFICATION_RESEND_COOLDOWN_SECONDS,
} from "@/back_end/services/verification";

export type ChangePasswordResponseBody =
  | { ok: true; resendAvailableAt: string }
  | { ok: false; error: string; retryAfterSeconds?: number };

// Mirrors register/route.ts's shape: the new password is staged in
// PendingPasswordChange rather than applied immediately — it only becomes
// User.passwordHash once the emailed code is confirmed at
// /api/account/password/verify.
export async function POST(request: NextRequest) {
  const db = getDb();
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json<ChangePasswordResponseBody>(
      { ok: false, error: "You're not logged in." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

  const passwordError = validatePassword(newPassword);
  if (passwordError) {
    return NextResponse.json<ChangePasswordResponseBody>(
      { ok: false, error: passwordError },
      { status: 400 },
    );
  }
  if (!isEmailDeliveryConfigured()) {
    return NextResponse.json<ChangePasswordResponseBody>(
      { ok: false, error: "Email confirmation isn't configured yet. Please try again later." },
      { status: 503 },
    );
  }

  try {
    const user = await db.user.findUnique({ where: { id: session.userId } });
    if (!user) {
      return NextResponse.json<ChangePasswordResponseBody>(
        { ok: false, error: "Account not found." },
        { status: 404 },
      );
    }

    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      return NextResponse.json<ChangePasswordResponseBody>(
        { ok: false, error: "Current password is incorrect." },
        { status: 401 },
      );
    }

    const existingPending = await db.pendingPasswordChange.findUnique({ where: { userId: user.id } });
    if (existingPending && existingPending.resendAvailableAt > new Date()) {
      const retryAfterSeconds = secondsUntil(existingPending.resendAvailableAt);
      return NextResponse.json<ChangePasswordResponseBody>(
        {
          ok: false,
          error: `We already sent a code. You can request another in ${retryAfterSeconds}s.`,
          retryAfterSeconds,
        },
        { status: 429 },
      );
    }

    const code = generateVerificationCode();
    const now = new Date();
    const resendAvailableAt = new Date(now.getTime() + VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000);
    const expiresAt = new Date(now.getTime() + VERIFICATION_CODE_TTL_MINUTES * 60 * 1000);
    const newPasswordHash = await hashPassword(newPassword);

    const pending = await db.pendingPasswordChange.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        newPasswordHash,
        verificationCodeHash: hashVerificationCode(code),
        expiresAt,
        resendAvailableAt,
      },
      update: {
        newPasswordHash,
        verificationCodeHash: hashVerificationCode(code),
        expiresAt,
        resendAvailableAt,
      },
    });

    try {
      await sendPasswordChangeConfirmationEmail(user.email, code);
    } catch (error) {
      await db.pendingPasswordChange.delete({ where: { id: pending.id } }).catch(() => undefined);
      console.error("POST /api/account/password email delivery failed", error);
      return NextResponse.json<ChangePasswordResponseBody>(
        { ok: false, error: "We couldn't send the confirmation email. Please try again later." },
        { status: 502 },
      );
    }

    return NextResponse.json<ChangePasswordResponseBody>({
      ok: true,
      resendAvailableAt: resendAvailableAt.toISOString(),
    });
  } catch (error) {
    console.error("POST /api/account/password failed", error);
    return NextResponse.json<ChangePasswordResponseBody>(
      { ok: false, error: "Couldn't start your password change. Please try again later." },
      { status: 500 },
    );
  }
}
