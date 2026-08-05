import { after } from "next/server";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/back_end/services/auth";
import { getDb } from "@/back_end/services/db";
import { deletePersonaMedia } from "@/back_end/services/storage";
import {
  failPersonaTrainingStart,
  PERSONA_TRAINING_STARTING_TASK_ID,
  prepareVoiceReference,
  submitAvatarTraining,
  TRAINING_RELEVANT_ASSET_TYPES,
} from "@/back_end/services/persona-training";
import { deleteRagSource } from "@/back_end/services/persona-rag";

export type DeleteAssetResponseBody = { ok: true } | { ok: false; error: string };

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; assetId: string }> },
) {
  const db = getDb();
  const user = await getCurrentUser().catch(() => null);
  if (!user || !user.emailVerified) {
    return NextResponse.json<DeleteAssetResponseBody>(
      { ok: false, error: "You're not logged in." },
      { status: 401 },
    );
  }

  const { id: personaId, assetId } = await params;
  try {
    const persona = await db.persona.findFirst({ where: { id: personaId, userId: user.id } });
    if (!persona) {
      return NextResponse.json<DeleteAssetResponseBody>(
        { ok: false, error: "Persona not found." },
        { status: 404 },
      );
    }

    const asset = await db.personaAsset.findFirst({ where: { id: assetId, personaId } });
    if (!asset) {
      return NextResponse.json<DeleteAssetResponseBody>(
        { ok: false, error: "Upload not found." },
        { status: 404 },
      );
    }

    // A transient R2 hiccup on this one object shouldn't permanently block
    // removing the asset (retrying would just hit the same object again) —
    // best-effort, logged, not fatal. Worst case is a small orphaned R2
    // object rather than a stuck upload the user can never remove.
    await deletePersonaMedia(asset.url).catch((error) => {
      console.error(`Couldn't delete R2 object ${asset.url} for asset ${asset.id}`, error);
    });
    await db.personaAsset.delete({ where: { id: asset.id } });

    // Deleting a photo/document/link doesn't touch the trained avatar or
    // voice — only retrain when what was removed could have fed either one.
    // There's no partial "forget just this file" for either model, so this
    // is a full retrain from whatever's left (see startPersonaTraining).
    //
    // Not gated on `status === "active"` — see the matching comment in
    // POST /api/personas/[id]/assets for why a still-"processing" persona
    // must still accept a retrigger (otherwise a delete that lands while an
    // earlier incomplete-asset-set attempt is stuck can be silently
    // dropped).
    if (persona.status !== "draft" && TRAINING_RELEVANT_ASSET_TYPES.includes(asset.type)) {
      await db.persona.update({
        where: { id: personaId },
        data: {
          status: "processing",
          trainingStartedAt: new Date(),
          avatarTrainingTaskId: PERSONA_TRAINING_STARTING_TASK_ID,
          liveAvatarId: null,
          avatarTrainingError: null,
        },
      });
      // Backgrounded via after() — avatar submission normally takes ~35s
      // (synchronous ffmpeg canonicalization on the GPU box), too long to
      // await directly without risking the platform's own request timeout.
      // If after() silently never completes, resolvePersonaTrainingState's
      // polling retries the submission inline once the "starting" sentinel
      // goes stale, so this self-heals without needing another upload.
      after(async () => {
        try {
          await submitAvatarTraining(db, personaId);
          await prepareVoiceReference(db, personaId);
        } catch (trainingError) {
          console.error("Background persona retraining start failed", trainingError);
          await failPersonaTrainingStart(db, personaId, trainingError).catch((stateError) => {
            console.error("Couldn't finalize failed persona retraining", stateError);
          });
        }
      });
    }

    // Text documents and compacted social-profile notes are indexed in the
    // private vector store. Their asset ID gives us an exact delete rather
    // than leaving old personal context behind after removal.
    if (asset.type === "text" || asset.type === "social_link") {
      after(async () => {
        try {
          await deleteRagSource(personaId, asset.id);
        } catch (ragError) {
          console.error("Background RAG source deletion failed", ragError);
        }
      });
    }

    return NextResponse.json<DeleteAssetResponseBody>({ ok: true });
  } catch (error) {
    console.error("DELETE /api/personas/[id]/assets/[assetId] failed", error);
    return NextResponse.json<DeleteAssetResponseBody>(
      { ok: false, error: "Couldn't delete this upload. Please try again." },
      { status: 500 },
    );
  }
}
