import { NextRequest, NextResponse } from "next/server";
import { validateEmail, validatePassword, validateUsername } from "@/back_end/services/auth";
import { hashPassword } from "@/back_end/services/password";
import { getDb } from "@/back_end/services/db";
import { isEmailDeliveryConfigured, sendRegistrationConfirmationEmail } from "@/back_end/services/email";
import {
  generateVerificationCode,
  generateRegistrationCancellationToken,
  hashRegistrationCancellationToken,
  hashVerificationCode,
  VERIFICATION_CODE_TTL_MINUTES,
  VERIFICATION_RESEND_COOLDOWN_SECONDS,
} from "@/back_end/services/verification";

export type RegisterResponseBody =
  | { ok: true; email: string; username: string; cancellationToken: string; resendAvailableAt: string }
  | { ok: false; errors: Record<string, string>; retryAfterSeconds?: number };

export async function POST(request: NextRequest) {
  const db = getDb();
  const body = await request.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  const errors: Record<string, string> = {};
  const usernameError = validateUsername(username);
  if (usernameError) errors.username = usernameError;
  const emailError = validateEmail(email);
  if (emailError) errors.email = emailError;
  const passwordError = validatePassword(password);
  if (passwordError) errors.password = passwordError;

  if (Object.keys(errors).length > 0) {
    return NextResponse.json<RegisterResponseBody>({ ok: false, errors }, { status: 400 });
  }
  if (!isEmailDeliveryConfigured()) {
    return NextResponse.json<RegisterResponseBody>(
      { ok: false, errors: { form: "Email confirmation isn't configured yet. Please try again later." } },
      { status: 503 },
    );
  }

  try {
    const [existingUsername, existingEmail, pendingForEmail, pendingForUsername] = await Promise.all([
      db.user.findUnique({ where: { username } }),
      db.user.findUnique({ where: { email } }),
      db.pendingRegistration.findUnique({ where: { email } }),
      db.pendingRegistration.findUnique({ where: { username } }),
    ]);

    if (existingUsername) errors.username = "That username is taken.";
    if (existingEmail) errors.email = "An account with that email already exists.";
    const now = new Date();
    const pendingRegistrations = [...new Map(
      [pendingForEmail, pendingForUsername].filter((pending): pending is NonNullable<typeof pending> => Boolean(pending)).map((pending) => [pending.id, pending]),
    ).values()];
    const expiredPendingIds = pendingRegistrations
      .filter((pending) => pending.expiresAt <= now)
      .map((pending) => pending.id);
    if (expiredPendingIds.length > 0) {
      await db.pendingRegistration.deleteMany({ where: { id: { in: expiredPendingIds } } });
    }
    const activePending = pendingRegistrations.filter((pending) => pending.expiresAt > now);
    if (activePending.some((pending) => pending.email === email)) {
      errors.email = "A confirmation is already in progress for that email.";
    }
    if (activePending.some((pending) => pending.username === username)) {
      errors.username = "A confirmation is already in progress for that username.";
    }
    if (Object.keys(errors).length > 0) {
      return NextResponse.json<RegisterResponseBody>({ ok: false, errors }, { status: 409 });
    }

    const code = generateVerificationCode();
    const cancellationToken = generateRegistrationCancellationToken();
    const resendAvailableAt = new Date(now.getTime() + VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000);
    const expiresAt = new Date(now.getTime() + VERIFICATION_CODE_TTL_MINUTES * 60 * 1000);
    const passwordHash = await hashPassword(password);

    const pending = await db.pendingRegistration.create({
      data: {
        username,
        email,
        passwordHash,
        verificationCodeHash: hashVerificationCode(code),
        cancellationTokenHash: hashRegistrationCancellationToken(cancellationToken),
        expiresAt,
        resendAvailableAt,
      },
    });

    try {
      await sendRegistrationConfirmationEmail(email, code);
    } catch (error) {
      await db.pendingRegistration.delete({ where: { id: pending.id } }).catch(() => undefined);
      console.error("POST /api/auth/register email delivery failed", error);
      return NextResponse.json<RegisterResponseBody>(
        { ok: false, errors: { form: "We couldn't send the confirmation email. Please try again later." } },
        { status: 502 },
      );
    }

    return NextResponse.json<RegisterResponseBody>({
      ok: true,
      email,
      username,
      cancellationToken,
      resendAvailableAt: resendAvailableAt.toISOString(),
    });
  } catch (error) {
    console.error("POST /api/auth/register failed", error);
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
      return NextResponse.json<RegisterResponseBody>(
        { ok: false, errors: { form: "A confirmation is already in progress for that email or username." } },
        { status: 409 },
      );
    }
    return NextResponse.json<RegisterResponseBody>(
      { ok: false, errors: { form: "We couldn't start your registration. Please try again later." } },
      { status: 500 },
    );
  }
}
