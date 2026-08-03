import { after } from "next/server";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/back_end/services/auth";
import { getDb } from "@/back_end/services/db";
import {
  failPersonaTrainingStart,
  PERSONA_TRAINING_STARTING_TASK_ID,
  resolvePersonaTrainingState,
  startPersonaTraining,
} from "@/back_end/services/persona-training";

export type FinishPersonaResponseBody =
  | { ok: true; status: "processing" | "active"; progress: number }
  | { ok: false; error: string };

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = getDb();
  const user = await getCurrentUser().catch(() => null);
  if (!user || !user.emailVerified) {
    return NextResponse.json<FinishPersonaResponseBody>(
      { ok: false, error: "You're not logged in." },
      { status: 401 },
    );
  }

  const { id: personaId } = await params;

  try {
    const persona = await db.persona.findFirst({ where: { id: personaId, userId: user.id } });
    if (!persona) {
      return NextResponse.json<FinishPersonaResponseBody>(
        { ok: false, error: "Persona not found." },
        { status: 404 },
      );
    }

    if (persona.status === "active") {
      return NextResponse.json<FinishPersonaResponseBody>({ ok: true, status: "active", progress: 100 });
    }

    if (persona.status === "processing") {
      const state = await resolvePersonaTrainingState(db, persona);
      return NextResponse.json<FinishPersonaResponseBody>({ ok: true, ...state });
    }

    const trainingStartedAt = new Date();
    await db.persona.update({
      where: { id: personaId },
      data: {
        status: "processing",
        trainingStartedAt,
        avatarTrainingTaskId: PERSONA_TRAINING_STARTING_TASK_ID,
        liveAvatarId: null,
        avatarTrainingError: null,
      },
    });
    after(async () => {
      try {
        console.info("[persona-training] initial training queued", { personaId });
        await startPersonaTraining(db, personaId);
      } catch (trainingError) {
        console.error("Background initial persona training start failed", trainingError);
        await failPersonaTrainingStart(db, personaId, trainingError).catch((stateError) => {
          console.error("Couldn't finalize failed initial persona training", stateError);
        });
      }
    });

    return NextResponse.json<FinishPersonaResponseBody>({ ok: true, status: "processing", progress: 0 });
  } catch (error) {
    console.error("POST /api/personas/[id]/finish failed", error);
    return NextResponse.json<FinishPersonaResponseBody>(
      { ok: false, error: "Couldn't finish setup — the database isn't reachable yet." },
      { status: 500 },
    );
  }
}
