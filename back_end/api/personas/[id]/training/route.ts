import { NextResponse } from "next/server";
import { getCurrentUser } from "@/back_end/services/auth";
import { getDb } from "@/back_end/services/db";
import { resolvePersonaTrainingState } from "@/back_end/services/persona-training";

export type PersonaTrainingResponseBody =
  | { ok: true; status: "processing" | "active"; progress: number }
  | { ok: false; error: string };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser().catch(() => null);
  if (!user || !user.emailVerified) {
    return NextResponse.json<PersonaTrainingResponseBody>(
      { ok: false, error: "You're not logged in." },
      { status: 401 },
    );
  }

  const { id: personaId } = await params;
  try {
    const db = getDb();
    const persona = await db.persona.findFirst({
      where: { id: personaId, userId: user.id },
      select: { id: true, status: true, avatarTrainingTaskId: true },
    });
    if (!persona) {
      return NextResponse.json<PersonaTrainingResponseBody>(
        { ok: false, error: "Persona not found." },
        { status: 404 },
      );
    }

    const state = await resolvePersonaTrainingState(db, persona);
    return NextResponse.json<PersonaTrainingResponseBody>({ ok: true, ...state }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    console.error("GET /api/personas/[id]/training failed", error);
    return NextResponse.json<PersonaTrainingResponseBody>(
      { ok: false, error: "Couldn't check persona preparation." },
      { status: 500 },
    );
  }
}
