import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/back_end/services/db";
import { startPersonaTraining } from "@/back_end/services/persona-training";

/**
 * Temporary, narrowly-scoped operator route: re-runs training for one named
 * persona from its existing assets (no new upload needed — see
 * startPersonaTraining/submitAvatarTraining, which always recompute from
 * whatever is already on file). Used to pick up a GPU-side pipeline fix
 * without asking the account owner to re-record anything. Removed again
 * once used — see the request that added it for context.
 */
const DEBUG_SECRET = "rt7Kx0mQ2vJpL9nF4bW8sD6cH1yU3zA5eG2iO0kM7qX9";
const PERSONA_ID = "cmsgupp1l0000psp7clp2e4go";

function authorized(request: NextRequest): boolean {
  return request.headers.get("x-debug-secret") === DEBUG_SECRET;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const db = getDb();
  const persona = await db.persona.findUnique({
    where: { id: PERSONA_ID },
    select: { id: true, name: true, status: true, liveAvatarId: true, avatarTrainingTaskId: true, avatarTrainingError: true, voiceRefAssetId: true },
  });
  return NextResponse.json({ ok: true, persona });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const db = getDb();
  try {
    await startPersonaTraining(db, PERSONA_ID);
    const persona = await db.persona.findUnique({
      where: { id: PERSONA_ID },
      select: { id: true, status: true, liveAvatarId: true, avatarTrainingTaskId: true, avatarTrainingError: true },
    });
    return NextResponse.json({ ok: true, persona });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
