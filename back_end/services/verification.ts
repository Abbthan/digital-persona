import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";

export const VERIFICATION_CODE_LENGTH = 6;
export const VERIFICATION_CODE_TTL_MINUTES = 15;
export const VERIFICATION_RESEND_COOLDOWN_SECONDS = 60;

const ALPHANUMERIC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateVerificationCode(): string {
  return Array.from(
    { length: VERIFICATION_CODE_LENGTH },
    () => ALPHANUMERIC[randomInt(ALPHANUMERIC.length)],
  ).join("");
}

export function normalizeVerificationCode(value: string): string {
  return value.trim().toUpperCase();
}

export function hashVerificationCode(code: string): string {
  return createHash("sha256").update(normalizeVerificationCode(code)).digest("hex");
}

export function verificationCodesMatch(code: string, hash: string): boolean {
  const candidate = Buffer.from(hashVerificationCode(code), "hex");
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** A browser-held capability used solely to cancel its own pending signup. */
export function generateRegistrationCancellationToken(): string {
  return randomUUID();
}

export function hashRegistrationCancellationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function registrationCancellationTokensMatch(token: string, hash: string | null): boolean {
  if (!hash) return false;
  const candidate = Buffer.from(hashRegistrationCancellationToken(token), "hex");
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function secondsUntil(date: Date): number {
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000));
}
