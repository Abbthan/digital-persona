import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/back_end/services/db";
import { startPersonaTraining } from "@/back_end/services/persona-training";
import { getAvatarTrainingTask } from "@/back_end/services/livetalking";

/**
 * Temporary, narrowly-scoped operator route: re-runs training for one named
 * persona from its existing assets (no new upload needed — see
 * startPersonaTraining/submitAvatarTraining, which always recompute from
 * whatever is already on file). Used to pick up a GPU-side pipeline fix
 * without asking the account owner to re-record anything. Removed again
 * once used — see the request that added it for context.
 */
const DEBUG_SECRET = "mL8vQ2xN6bR9wK4jT0pY7cH3zA1sD5fG";
const PERSONA_ID = "cmsjqcvp60002psp73uk39ks9";

function authorized(request: NextRequest): boolean {
  return request.headers.get("x-debug-secret") === DEBUG_SECRET;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const db = getDb();

  if (request.nextUrl.searchParams.get("reconcile") === "1") {
    const before = await db.persona.findUnique({ where: { id: PERSONA_ID }, select: { avatarTrainingTaskId: true } });
    if (!before?.avatarTrainingTaskId) {
      return NextResponse.json({ ok: false, error: "No avatarTrainingTaskId on record." }, { status: 400 });
    }
    const task = await getAvatarTrainingTask(PERSONA_ID, before.avatarTrainingTaskId);
    if (!task) return NextResponse.json({ ok: true, reconciled: false, reason: "task not found (GPU process may have restarted)" });
    if (task.status === "pending" || task.status === "processing" || task.status === "running") {
      return NextResponse.json({ ok: true, reconciled: false, taskStatus: task.status, progress: task.progress });
    }
    const persona = await db.persona.update({
      where: { id: PERSONA_ID },
      data: task.status === "completed"
        ? { liveAvatarId: `persona_${PERSONA_ID}`, avatarTrainingError: null }
        : { avatarTrainingError: task.error_msg || "Avatar training failed.", liveAvatarId: null },
      select: { id: true, status: true, liveAvatarId: true, avatarTrainingTaskId: true, avatarTrainingError: true },
    });
    return NextResponse.json({ ok: true, reconciled: true, taskStatus: task.status, persona });
  }

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
