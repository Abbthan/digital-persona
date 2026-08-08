import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/back_end/services/db";

/**
 * Temporary diagnostic route for the Wu-dialect-slider bounce-back bug
 * report (2026-08-08): does the PATCH write actually fail, or does a
 * near-immediate read return a stale cached value? Removed once diagnosed.
 */
const DEBUG_SECRET = "dg4Nx8pQwR2vJmK6bH9cW3zL5eT1yU7oI0aS4fD8";
const PERSONA_ID = "cmsgupp1l0000psp7clp2e4go";

export async function GET(request: NextRequest) {
  if (request.headers.get("x-debug-secret") !== DEBUG_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const log: Record<string, unknown> = {};

  try {
    log.allPersonas = await db.persona.findMany({
      select: { id: true, name: true, userId: true, status: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

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
