import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/back_end/services/db";
import {
  submitAvatarTraining,
  prepareVoiceReference,
  resolvePersonaTrainingState,
  selectAvatarSourceAsset,
  TRAINING_RELEVANT_ASSET_TYPES,
} from "@/back_end/services/persona-training";

// TEMPORARY debug route — added to trigger a real retrain for a specific
// persona outside the normal authenticated user flow (server-side
// maintenance action), through the actual production runtime so
// submitAvatarTraining()/prepareVoiceReference() run faithfully rather than
// being reimplemented by hand. Removed immediately after use — do not leave
// this deployed.
const DEBUG_SECRET = "hpESrXDNgQpNPYa6D4IaTdcUKeuP0_TMbb9ZKwTVzYE";

export async function GET(request: NextRequest) {
  const auth = request.headers.get("x-debug-secret");
  if (auth !== DEBUG_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const personas = await db.persona.findMany({
    where: { name: { contains: "ethan", mode: "insensitive" } },
    select: {
      id: true,
      userId: true,
      name: true,
      status: true,
      liveAvatarId: true,
      avatarTrainingTaskId: true,
      avatarTrainingError: true,
      voiceRefAssetId: true,
      voiceRefTranscript: true,
      trainingStartedAt: true,
      createdAt: true,
      assets: { select: { id: true, type: true, metadata: true, createdAt: true } },
    },
  });
  const withState = await Promise.all(
    personas.map(async (persona) => ({
      ...persona,
      trainingState: await resolvePersonaTrainingState(db, persona).catch((error) => String(error)),
    })),
  );

  // Debug: replicate loadTrainingAssets' exact query + selection for the
  // first matching persona, to see precisely why avatarSelection is/isn't
  // found without guessing.
  const debugPersonaId = personas[0]?.id;
  let debugSelection: unknown = null;
  if (debugPersonaId) {
    const relevantAssets = await db.personaAsset.findMany({
      where: { personaId: debugPersonaId, type: { in: TRAINING_RELEVANT_ASSET_TYPES } },
      orderBy: { createdAt: "desc" },
      select: { id: true, type: true, url: true, metadata: true },
    });
    debugSelection = {
      relevantAssets,
      avatarSelection: selectAvatarSourceAsset(relevantAssets),
    };
  }

  return NextResponse.json({ ok: true, personas: withState, debugSelection });
}

export async function POST(request: NextRequest) {
  const auth = request.headers.get("x-debug-secret");
  if (auth !== DEBUG_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const personaId = typeof body?.personaId === "string" ? body.personaId : "";
  if (!personaId) {
    return NextResponse.json({ ok: false, error: "personaId required" }, { status: 400 });
  }

  const db = getDb();
  try {
    const avatarResult = await submitAvatarTraining(db, personaId);
    const voiceResult = await prepareVoiceReference(db, personaId);
    return NextResponse.json({ ok: true, avatarResult, voiceResult });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
