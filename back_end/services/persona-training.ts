import type { AssetType, PrismaClient } from "@/generated/prisma/client";
import {
  getAvatarReadiness,
  getAvatarTrainingTask,
  submitAvatarTrainingJob,
} from "@/back_end/services/live-avatar";
import { saveVoiceReference } from "@/back_end/services/speech";
import { PERSONA_ASSET_SOURCES } from "@/shared/persona-asset-sources";

export type PersonaTrainingState = {
  status: "processing" | "active";
  progress: number;
};

/**
 * Asset types that feed the avatar/voice training pipeline. A photo can be a
 * usable fallback likeness when a persona has no facial scan or video, and a
 * video can provide the best available voice-reference track when no separate
 * audio recording was supplied.
 */
export const TRAINING_RELEVANT_ASSET_TYPES: AssetType[] = ["image", "video", "facial_scan", "audio"];

type AssetRow = { id: string; type: AssetType; url: string; metadata: unknown };

export const PERSONA_TRAINING_STARTING_TASK_ID = "starting";
const TRAINING_START_TIMEOUT_MS = 3 * 60_000;

function metadataOf(metadata: unknown): { originalName?: string; size?: number; source?: string } {
  return metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
}

function originalName(asset: AssetRow): string {
  return metadataOf(asset.metadata).originalName ?? asset.url.split("/").pop() ?? "file";
}

/**
 * Live video is deliberately gated on two purpose-recorded inputs. The
 * guided scan supplies an explicit identity/consent reference; the passive
 * scan supplies the closed-mouth blinking, breathing, and posture motion
 * that LiveTalking loops while no speech is playing. Ordinary video uploads
 * remain available to RAG/media analysis, but cannot silently enable a live
 * likeness or replace either consented scan.
 */
export function selectAvatarSourceAsset(assets: AssetRow[]): AssetRow | null {
  const facialReference = assets.find((asset) => asset.type === "facial_scan") ?? null;
  const guidedScan = assets.find((asset) => (
    asset.type === "video" && metadataOf(asset.metadata).source === PERSONA_ASSET_SOURCES.guidedFacialScan
  )) ?? null;
  const passiveScan = assets.find((asset) => (
    asset.type === "video" && metadataOf(asset.metadata).source === PERSONA_ASSET_SOURCES.passiveFacialScan
  )) ?? null;

  return facialReference && guidedScan && passiveScan ? passiveScan : null;
}

// The dedicated recorder produces exactly one known-good sample; uploaded
// files have no duration metadata, so byte size is the best available proxy
// for "probably the longest, most useful clip."
function selectVoiceRefAsset(assets: AssetRow[]): AssetRow | null {
  const audioAssets = assets.filter((asset) => asset.type === "audio");
  const recorded = audioAssets.find((asset) => metadataOf(asset.metadata).source === "audio_recording");
  if (recorded) return recorded;
  const largestAudio = audioAssets
    .sort((a, b) => (metadataOf(b.metadata).size ?? 0) - (metadataOf(a.metadata).size ?? 0))[0];
  if (largestAudio) return largestAudio;

  // `saveVoiceReference()` uses ffmpeg, so the audio track of an MP4/MOV can
  // be normalized into the same 16 kHz WAV reference as MP3/WAV/WebM uploads.
  // Prefer a dedicated recording whenever available, but do not discard the
  // useful speech a creator supplied only inside a video.
  return assets
    .filter((asset) => asset.type === "video")
    .sort((a, b) => (metadataOf(b.metadata).size ?? 0) - (metadataOf(a.metadata).size ?? 0))[0] ?? null;
}

/**
 * Real per-persona training: picks the best available source for each of
 * avatar (MuseTalk) and voice (CosyVoice), submits/updates them, and clears
 * the corresponding fields when a source no longer exists (a delete leaving
 * nothing behind "unlearns" it — there's no partial/selective unlearning for
 * either model, so this is a full retrain from whatever remains).
 */
export async function startPersonaTraining(db: PrismaClient, personaId: string): Promise<void> {
  const assets = await db.personaAsset.findMany({
    where: { personaId, type: { in: TRAINING_RELEVANT_ASSET_TYPES } },
    orderBy: { createdAt: "desc" },
    select: { id: true, type: true, url: true, metadata: true },
  });

  const voiceAsset = selectVoiceRefAsset(assets);
  const avatarSelection = selectAvatarSourceAsset(assets);
  console.info("[persona-training] source inventory", {
    personaId,
    assetTypes: assets.map((asset) => asset.type),
    voiceSourceAssetId: voiceAsset?.id ?? null,
    avatarSourceAssetId: avatarSelection?.id ?? null,
  });

  // Submit the avatar job before voice transcription. The GPU returns a task
  // ID immediately, which replaces the temporary "starting" sentinel before
  // a slower Whisper/CosyVoice reference operation can run. This is what
  // makes progress polling durable instead of racing to a false 100%.
  if (avatarSelection) {
    console.info("[persona-training] avatar source selected", {
      personaId,
      assetId: avatarSelection.id,
      assetType: avatarSelection.type,
      source: metadataOf(avatarSelection.metadata).source ?? "upload",
      fileName: originalName(avatarSelection),
    });
    const avatarId = `persona_${personaId}`;
    const result = await submitAvatarTrainingJob(personaId, avatarId, {
      id: avatarSelection.id,
      fileName: originalName(avatarSelection),
    });
    if (!result.ok) console.error("[persona-training] avatar submission failed", { personaId, error: result.error });
    await db.persona.update({
      where: { id: personaId },
      data: result.ok
        // Do not expose this ID to the live-session endpoint yet. The GPU
        // service writes the avatar directory asynchronously, and loading it
        // before the task has completed can otherwise make a conversation
        // wait on incomplete files (or fail outright).
        ? { avatarTrainingTaskId: result.taskId, liveAvatarId: null, avatarTrainingError: null }
        : {
            status: "active",
            trainingStartedAt: null,
            avatarTrainingTaskId: null,
            liveAvatarId: null,
            avatarTrainingError: result.error,
          },
    });
  }

  // Voice-reference preparation is independent from MuseTalk. A failed
  // transcript must not discard an already-running avatar task or strand its
  // progress state; it simply leaves the existing/default voice unavailable.
  try {
    if (voiceAsset) {
      const transcript = await saveVoiceReference(personaId, {
        id: voiceAsset.id,
        fileName: originalName(voiceAsset),
      });
      await db.persona.update({
        where: { id: personaId },
        data: { voiceRefAssetId: voiceAsset.id, voiceRefTranscript: transcript },
      });
    } else {
      await db.persona.update({
        where: { id: personaId },
        data: { voiceRefAssetId: null, voiceRefTranscript: null },
      });
    }
  } catch (error) {
    console.error("[persona-training] voice reference preparation failed", { personaId, error });
  }

  if (avatarSelection) return;

  // Missing either dedicated scan means chat-only by design. Clear the
  // database pointer so the old or generic avatar can never appear. The
  // generated package stays private and inert until the next retrain or the
  // persona's full GPU cleanup; deleting it here would also delete the voice
  // reference that was just refreshed above.
  console.info("[persona-training] live video disabled until both facial scans exist", { personaId });
  await db.persona.update({
    where: { id: personaId },
    data: {
      status: "active",
      trainingStartedAt: null,
      avatarTrainingTaskId: null,
      liveAvatarId: null,
      avatarTrainingError: null,
    },
  });
}

export async function failPersonaTrainingStart(
  db: PrismaClient,
  personaId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : "Persona preparation could not start.";
  await db.persona.updateMany({
    where: { id: personaId, status: "processing" },
    data: {
      status: "active",
      trainingStartedAt: null,
      avatarTrainingTaskId: null,
      liveAvatarId: null,
      avatarTrainingError: message,
    },
  });
}

export async function resolvePersonaTrainingState(
  db: PrismaClient,
  persona: { id: string; status: string; avatarTrainingTaskId: string | null; trainingStartedAt?: Date | null },
): Promise<PersonaTrainingState> {
  if (persona.status !== "processing") return { status: "active", progress: 100 };

  if (persona.avatarTrainingTaskId === PERSONA_TRAINING_STARTING_TASK_ID) {
    const ageMs = persona.trainingStartedAt ? Date.now() - persona.trainingStartedAt.getTime() : 0;
    if (ageMs < TRAINING_START_TIMEOUT_MS) return { status: "processing", progress: 1 };

    const error = "Persona preparation did not start in time. The persona is available for chat; re-save either facial scan to retry live video.";
    await db.persona.updateMany({
      where: {
        id: persona.id,
        status: "processing",
        avatarTrainingTaskId: PERSONA_TRAINING_STARTING_TASK_ID,
      },
      data: {
        status: "active",
        trainingStartedAt: null,
        avatarTrainingTaskId: null,
        liveAvatarId: null,
        avatarTrainingError: error,
      },
    });
    return { status: "active", progress: 100 };
  }

  if (!persona.avatarTrainingTaskId) {
    // Compatibility recovery for records created before the explicit
    // "starting" sentinel existed. New jobs never enter this ambiguous state.
    await db.persona.updateMany({
      where: { id: persona.id, status: "processing" },
      data: { status: "active", trainingStartedAt: null },
    });
    return { status: "active", progress: 100 };
  }

  const task = await getAvatarTrainingTask(persona.id, persona.avatarTrainingTaskId);
  if (!task) {
    // The A800's task manager is in memory and is reset during a controlled
    // service restart. Its generated avatar directory persists, so reconcile
    // from that durable package before deciding that setup is still running.
    const readiness = await getAvatarReadiness(persona.id);
    if (readiness === "completed") {
      console.info("[persona-training] recovered completed avatar after task reset", { personaId: persona.id });
      await db.persona.updateMany({
        where: { id: persona.id, status: "processing" },
        data: {
          status: "active",
          trainingStartedAt: null,
          liveAvatarId: `persona_${persona.id}`,
          avatarTrainingError: null,
        },
      });
      return { status: "active", progress: 100 };
    }
    if (readiness === "missing") {
      const error = "Avatar preparation stopped before the generated files were complete. Upload or record a face video again to retry.";
      console.error("[persona-training] avatar task disappeared without generated files", { personaId: persona.id });
      await db.persona.updateMany({
        where: { id: persona.id, status: "processing" },
        data: { status: "active", trainingStartedAt: null, liveAvatarId: null, avatarTrainingError: error },
      });
      return { status: "active", progress: 100 };
    }
    return { status: "processing", progress: 0 };
  }
  if (task.status === "pending" || task.status === "processing" || task.status === "running") {
    // 100 means usable, not merely "GPU reported its last frame". Keep the
    // visible bar below completion until the durable task status is complete
    // and liveAvatarId has been committed below.
    return { status: "processing", progress: Math.min(99, Math.max(1, task.progress ?? 1)) };
  }

  // completed or failed — either way the persona becomes usable; a failed
  // avatar job just means no live avatar yet, not a broken persona.
  await db.persona.updateMany({
    where: { id: persona.id, status: "processing" },
    data: {
      status: "active",
      trainingStartedAt: null,
      ...(task.status === "completed"
        ? { liveAvatarId: `persona_${persona.id}`, avatarTrainingError: null }
        : { avatarTrainingError: task.error_msg || "Avatar training failed.", liveAvatarId: null }),
    },
  });
  return { status: "active", progress: 100 };
}
