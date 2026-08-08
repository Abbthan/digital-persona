import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/back_end/services/db";

/**
 * Temporary diagnostic route for the Wu-dialect-slider bounce-back bug
 * report (2026-08-08): does the PATCH write actually fail, or does a
 * near-immediate read return a stale cached value? Removed once diagnosed.
 */
const DEBUG_SECRET = "dg4Nx8pQwR2vJmK6bH9cW3zL5eT1yU7oI0aS4fD8";
const PERSONA_ID = "cmsjqcvp60002psp73uk39ks9";

export async function POST(request: NextRequest) {
  if (request.headers.get("x-debug-secret") !== DEBUG_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const log: Record<string, unknown> = {};

  try {
    const before = await db.persona.findUnique({
      where: { id: PERSONA_ID },
      select: { id: true, name: true, sttDialectPreference: true },
    });
    log.before = before;

    const updated = await db.persona.update({
      where: { id: PERSONA_ID },
      data: { sttDialectPreference: "wu" },
      select: { sttDialectPreference: true },
    });
    log.updateResult = updated;

    const immediateRead = await db.persona.findUnique({
      where: { id: PERSONA_ID },
      select: { sttDialectPreference: true },
    });
    log.immediateRead = immediateRead;

    // Restore original value so this test doesn't leave a side effect.
    const restored = await db.persona.update({
      where: { id: PERSONA_ID },
      data: { sttDialectPreference: before?.sttDialectPreference ?? "mandarin" },
      select: { sttDialectPreference: true },
    });
    log.restored = restored;

    return NextResponse.json({ ok: true, log });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      log,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }, { status: 500 });
  }
}
