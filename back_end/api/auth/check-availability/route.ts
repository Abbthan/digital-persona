import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/back_end/services/db";
import { emailFormatError, usernameFormatError } from "@/shared/validation";

export type CheckAvailabilityResponseBody = { available: true } | { available: false; error: string };

// Live field-level check used while filling out the register form (on blur),
// distinct from the authoritative recheck register/route.ts does at submit
// time — this one exists purely to surface "that's taken" / "that's not a
// valid email" before the user gets that far. A DB hiccup here shouldn't
// block someone from continuing to fill out the form — register/route.ts is
// the real gate — so failures resolve as "available" rather than surfacing
// an error for a check that's advisory, not authoritative.
export async function POST(request: NextRequest) {
  const db = getDb();
  const body = await request.json().catch(() => null);
  const field = body?.field;
  const value = typeof body?.value === "string" ? body.value.trim() : "";

  try {
    if (field === "username") {
      const formatError = usernameFormatError(value);
      if (formatError) {
        return NextResponse.json<CheckAvailabilityResponseBody>({ available: false, error: formatError });
      }

      const [existingUser, pending] = await Promise.all([
        db.user.findUnique({ where: { username: value } }),
        db.pendingRegistration.findUnique({ where: { username: value } }),
      ]);
      if (existingUser || pending) {
        return NextResponse.json<CheckAvailabilityResponseBody>({
          available: false,
          error: "That username is taken.",
        });
      }
      return NextResponse.json<CheckAvailabilityResponseBody>({ available: true });
    }

    if (field === "email") {
      const normalized = value.toLowerCase();
      const formatError = emailFormatError(normalized);
      if (formatError) {
        return NextResponse.json<CheckAvailabilityResponseBody>({ available: false, error: formatError });
      }

      const [existingUser, pending] = await Promise.all([
        db.user.findUnique({ where: { email: normalized } }),
        db.pendingRegistration.findUnique({ where: { email: normalized } }),
      ]);
      if (existingUser || pending) {
        return NextResponse.json<CheckAvailabilityResponseBody>({
          available: false,
          error: "An account with that email already exists.",
        });
      }
      return NextResponse.json<CheckAvailabilityResponseBody>({ available: true });
    }
  } catch (error) {
    console.error("POST /api/auth/check-availability failed", error);
    return NextResponse.json<CheckAvailabilityResponseBody>({ available: true });
  }

  return NextResponse.json<CheckAvailabilityResponseBody>(
    { available: false, error: "Invalid field." },
    { status: 400 },
  );
}
