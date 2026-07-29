import { NextRequest, NextResponse } from "next/server";
import { validateEmail } from "@/back_end/services/auth";
import { getDb } from "@/back_end/services/db";
import { isEmailDeliveryConfigured, sendRegistrationConfirmationEmail } from "@/back_end/services/email";
import {
  generateVerificationCode,
  hashVerificationCode,
  registrationCancellationTokensMatch,
  secondsUntil,
  VERIFICATION_CODE_TTL_MINUTES,
  VERIFICATION_RESEND_COOLDOWN_SECONDS,
} from "@/back_end/services/verification";

export type ResendCodeResponseBody =
  | { ok: true; resendAvailableAt: string }
  | { ok: false; error: string; retryAfterSeconds?: number };

export async function POST(request: NextRequest) {
  const db = getDb();
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const cancellationToken = typeof body?.cancellationToken === "string" ? body.cancellationToken : "";
  const emailError = validateEmail(email);
  if (emailError) {
    return NextResponse.json<ResendCodeResponseBody>({ ok: false, error: emailError }, { status: 400 });
  }
  if (!isEmailDeliveryConfigured()) {
    return NextResponse.json<ResendCodeResponseBody>(
      { ok: false, error: "Email confirmation isn't configured yet." },
      { status: 503 },
    );
  }

  try {
    const pending = await db.pendingRegistration.findUnique({ where: { email } });
    if (!pending) {
      return NextResponse.json<ResendCodeResponseBody>(
        { ok: false, error: "No pending registration was found for that email." },
        { status: 404 },
      );
    }
    if (!registrationCancellationTokensMatch(cancellationToken, pending.cancellationTokenHash)) {
      return NextResponse.json<ResendCodeResponseBody>(
        { ok: false, error: "This confirmation is no longer active. Please register again." },
        { status: 409 },
      );
    }
    if (pending.resendAvailableAt > new Date()) {
      const retryAfterSeconds = secondsUntil(pending.resendAvailableAt);
      return NextResponse.json<ResendCodeResponseBody>(
        { ok: false, error: `Please wait ${retryAfterSeconds}s before requesting another code.`, retryAfterSeconds },
        { status: 429 },
      );
    }

    const code = generateVerificationCode();
    const now = new Date();
    const resendAvailableAt = new Date(now.getTime() + VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000);
    await db.pendingRegistration.update({
      where: { id: pending.id },
      data: {
        verificationCodeHash: hashVerificationCode(code),
        expiresAt: new Date(now.getTime() + VERIFICATION_CODE_TTL_MINUTES * 60 * 1000),
        resendAvailableAt,
      },
    });

    await sendRegistrationConfirmationEmail(email, code);
    return NextResponse.json<ResendCodeResponseBody>({ ok: true, resendAvailableAt: resendAvailableAt.toISOString() });
  } catch (error) {
    console.error("POST /api/auth/resend-code failed", error);
    return NextResponse.json<ResendCodeResponseBody>(
      { ok: false, error: "We couldn't send a new code. Please try again." },
      { status: 500 },
    );
  }
}
