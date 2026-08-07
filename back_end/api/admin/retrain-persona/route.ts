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
const DEBUG_SECRET = "rt7Kx0mQ2vJpL9nF4bW8sD6cH1yU3zA5eG2iO0kM7qX9";
const PERSONA_ID = "cmsgupp1l0000psp7clp2e4go";

function authorized(request: NextRequest): boolean {
  return request.headers.get("x-debug-secret") === DEBUG_SECRET;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const db = getDb();

  // resolvePersonaTrainingState's own completed-task reconciliation only
  // runs while status === "processing" (its normal upload-triggered path
  // sets that first). This route calls startPersonaTraining() directly and
  // never flips status, so it needs the same reconciliation done here
  // explicitly once the GPU-side task is actually done.
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
