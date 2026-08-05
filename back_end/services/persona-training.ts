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
 * Live video is deliberately gated on two purpose-recorded inputs. Both are
 * required as an explicit identity/consent reference and a real motion
 * source, but they now feed two separate loops: the guided scan (LivePortrait-
 * enhanced) becomes MuseTalk's primary baked avatar — its genuinely recorded
 * talking motion is what shows during actual speech — while the passive
 * scan's closed-mouth blinking/breathing loop is baked separately as the
 * idle-only source LiveTalking switches to while no speech is playing (see
 * personaIdleActionConfig / docs/gpu-liveportrait-integration.md). Before
 * that idle loop existed, the passive scan had to double as both — this
 * selection changed once it no longer needs to. Ordinary video uploads
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

  return facialReference && guidedScan && passiveScan ? guidedScan : null;
}

// The passive scan, gated by the same three-asset requirement as
// selectAvatarSourceAsset (there is no standalone idle loop without a
// primary avatar to pair it with). Kept as a separate lookup rather than
// changing selectAvatarSourceAsset's return shape, since that function is
// also exercised directly by scripts/verify-persona-training-selection.ts.
function selectIdleSourceAsset(assets: AssetRow[]): AssetRow | null {
  if (!selectAvatarSourceAsset(assets)) return null;
  return assets.find((asset) => (
    asset.type === "video" && metadataOf(asset.metadata).source === PERSONA_ASSET_SOURCES.passiveFacialScan
  )) ?? null;
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

async function loadTrainingAssets(db: PrismaClient, personaId: string) {
  const assets = await db.personaAsset.findMany({
    where: { personaId, type: { in: TRAINING_RELEVANT_ASSET_TYPES } },
    orderBy: { createdAt: "desc" },
    select: { id: true, type: true, url: true, metadata: true },
  });
  return {
    assets,
    voiceAsset: selectVoiceRefAsset(assets),
    avatarSelection: selectAvatarSourceAsset(assets),
    idleSelection: selectIdleSourceAsset(assets),
  };
}

/**
 * Submits the MuseTalk avatar job and writes back its outcome — a real task
 * id, a real error, or (if the required scans aren't all present yet) a
 * clean reset to "active". Deliberately awaited directly by callers rather
 * than wrapped in `after()`: Cloudflare's background-task extension is not a
 * durable queue, and a network call that determines whether training is
 * even possible must not be allowed to run only in the background. A real
 * persona was stranded at the "starting" sentinel for hours because this
 * used to run exclusively inside `after()` — if that callback silently
 * never completed (platform-level, not a caught error), nothing ever wrote
 * a terminal state, and nothing but a client re-polling the training-status
 * endpoint past the 3-minute timeout could ever notice or recover. Bounded
 * by submitAvatarTrainingJob's own 15s fetch timeout, so this can't hang the
 * request that awaits it.
 */
export async function submitAvatarTraining(db: PrismaClient, personaId: string): Promise<{ started: boolean }> {
  const { assets, avatarSelection, idleSelection } = await loadTrainingAssets(db, personaId);
  console.info("[persona-training] source inventory", {
    personaId,
    assetTypes: assets.map((asset) => asset.type),
    avatarSourceAssetId: avatarSelection?.id ?? null,
    idleSourceAssetId: idleSelection?.id ?? null,
  });

  if (!avatarSelection) {
    // Missing either dedicated scan means chat-only by design. Clear the
    // database pointer so the old or generic avatar can never appear. The
    // generated package stays private and inert until the next retrain or
    // the persona's full GPU cleanup.
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
    return { started: false };
  }

  console.info("[persona-training] avatar source selected", {
    personaId,
    assetId: avatarSelection.id,
    assetType: avatarSelection.type,
    source: metadataOf(avatarSelection.metadata).source ?? "upload",
    fileName: originalName(avatarSelection),
  });
  const avatarId = `persona_${personaId}`;
  const result = await submitAvatarTrainingJob(
    personaId,
    avatarId,
    { id: avatarSelection.id, fileName: originalName(avatarSelection) },
    idleSelection ? { id: idleSelection.id, fileName: originalName(idleSelection) } : undefined,
  );
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
  return { started: result.ok };
}

/**
 * Voice-reference preparation (CosyVoice) is independent from MuseTalk and
 * genuinely slow (a real transcription round trip), so this is the one part
 * of training still meant to run in the background via `after()`. A failed
 * transcript must not discard an already-running avatar task or strand its
 * progress state; it simply leaves the existing/default voice unavailable.
 * Bounded by saveVoiceReference's own 45s fetch timeout.
 */
export async function prepareVoiceReference(db: PrismaClient, personaId: string): Promise<void> {
  const { voiceAsset } = await loadTrainingAssets(db, personaId);
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
}

/**
 * Convenience wrapper for callers that genuinely want to await the entire
 * pipeline (e.g. a one-off script). Real request handlers should call
 * submitAvatarTraining() synchronously and prepareVoiceReference() via
 * after() instead — see the comment on submitAvatarTraining for why.
 */
export async function startPersonaTraining(db: PrismaClient, personaId: string): Promise<void> {
  await submitAvatarTraining(db, personaId);
  await prepareVoiceReference(db, personaId);
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
