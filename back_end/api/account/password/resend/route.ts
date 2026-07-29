import { NextResponse } from "next/server";
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

export type ResendPasswordChangeCodeResponseBody =
  | { ok: true; resendAvailableAt: string }
  | { ok: false; error: string; retryAfterSeconds?: number };

export async function POST() {
  const db = getDb();
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json<ResendPasswordChangeCodeResponseBody>(
      { ok: false, error: "You're not logged in." },
      { status: 401 },
    );
  }
  if (!isEmailDeliveryConfigured()) {
    return NextResponse.json<ResendPasswordChangeCodeResponseBody>(
      { ok: false, error: "Email confirmation isn't configured yet." },
      { status: 503 },
    );
  }

  try {
    const pending = await db.pendingPasswordChange.findUnique({ where: { userId: session.userId } });
    if (!pending) {
      return NextResponse.json<ResendPasswordChangeCodeResponseBody>(
        { ok: false, error: "No pending password change was found." },
        { status: 404 },
      );
    }
    if (pending.resendAvailableAt > new Date()) {
      const retryAfterSeconds = secondsUntil(pending.resendAvailableAt);
      return NextResponse.json<ResendPasswordChangeCodeResponseBody>(
        { ok: false, error: `Please wait ${retryAfterSeconds}s before requesting another code.`, retryAfterSeconds },
        { status: 429 },
      );
    }

    const user = await db.user.findUnique({ where: { id: session.userId } });
    if (!user) {
      return NextResponse.json<ResendPasswordChangeCodeResponseBody>(
        { ok: false, error: "Account not found." },
        { status: 404 },
      );
    }

    const code = generateVerificationCode();
    const now = new Date();
    const resendAvailableAt = new Date(now.getTime() + VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000);
    await db.pendingPasswordChange.update({
      where: { id: pending.id },
      data: {
        verificationCodeHash: hashVerificationCode(code),
        expiresAt: new Date(now.getTime() + VERIFICATION_CODE_TTL_MINUTES * 60 * 1000),
        resendAvailableAt,
      },
    });

    await sendPasswordChangeConfirmationEmail(user.email, code);
    return NextResponse.json<ResendPasswordChangeCodeResponseBody>({
      ok: true,
      resendAvailableAt: resendAvailableAt.toISOString(),
    });
  } catch (error) {
    console.error("POST /api/account/password/resend failed", error);
    return NextResponse.json<ResendPasswordChangeCodeResponseBody>(
      { ok: false, error: "We couldn't send a new code. Please try again." },
      { status: 500 },
    );
  }
}
