import type { AssetType, PrismaClient } from "@/generated/prisma/client";
import {
  checkFaceMatch,
  getAvatarReadiness,
  getAvatarTrainingTask,
  submitAvatarTrainingJob,
} from "@/back_end/services/live-avatar";
import { saveVoiceReference } from "@/back_end/services/speech";

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

function metadataOf(metadata: unknown): { originalName?: string; size?: number; source?: string } {
  return metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
}

// Real video (natural head movement) makes a meaningfully better MuseTalk
// avatar than a single looped photo — but only a video actually confirmed
// (via the GPU box's face_recognition check) to show the same person as the
// facial scan is trusted with that; an uploaded video that doesn't match
// falls back to the scan itself rather than risk training on someone else's
// face. Without a facial scan to check against, there's no ground truth to
// enforce, so any video is trusted as before.
function originalName(asset: AssetRow): string {
  return metadataOf(asset.metadata).originalName ?? asset.url.split("/").pop() ?? "file";
}

async function selectAvatarSourceAsset(
  personaId: string,
  assets: AssetRow[],
): Promise<AssetRow | null> {
  const facialScan = assets.find((asset) => asset.type === "facial_scan") ?? null;
  const videos = assets.filter((asset) => asset.type === "video");
  const images = assets.filter((asset) => asset.type === "image");

  if (facialScan && videos.length > 0) {
    let best: { asset: AssetRow; distance: number } | null = null;
    let capturedMotionFallback: AssetRow | null = null;
    for (const video of videos) {
      // Both private R2 files are streamed directly to the A800 for face
      // matching. The Worker only sends their asset identifiers/URLs.
      const result = await checkFaceMatch(
        personaId,
        { id: facialScan.id, fileName: originalName(facialScan) },
        { id: video.id, fileName: originalName(video) },
      );
      if (result?.match && (best === null || (result.distance ?? Infinity) < best.distance)) {
        best = { asset: video, distance: result.distance ?? Infinity };
      }
      // A facial motion clip and its scan are captured in the same session.
      // If the optional face-match service is temporarily unavailable, trust
      // that paired capture over degrading the avatar to a looped still.
      if (result === null && metadataOf(video.metadata).source === "facial_camera" && !capturedMotionFallback) {
        capturedMotionFallback = video;
      }
    }
    if (best) return best.asset;
    if (capturedMotionFallback) return capturedMotionFallback;
  }

  if (facialScan) return facialScan;

  const fallbackVideo = videos[0];
  if (fallbackVideo) return fallbackVideo;

  // A single high-quality photo is sufficient for MuseTalk's image-driven
  // training route when the creator did not provide a dedicated facial scan
  // or a video. It is intentionally a last resort: a scan/video remains a
  // more explicit and reliable likeness source.
  const fallbackImage = images[0];
  if (fallbackImage) return fallbackImage;
  return null;
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
  console.info("[persona-training] source inventory", {
    personaId,
    assetTypes: assets.map((asset) => asset.type),
    voiceSourceAssetId: voiceAsset?.id ?? null,
  });
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

  const avatarSelection = await selectAvatarSourceAsset(personaId, assets);
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
        : { avatarTrainingTaskId: null, avatarTrainingError: result.error },
    });
    return;
  }

  // No usable source (or the storage read failed) — nothing to train.
  console.warn("[persona-training] no avatar source found", { personaId });
  await db.persona.update({
    where: { id: personaId },
    data: { avatarTrainingTaskId: null, liveAvatarId: null },
  });
}

export async function resolvePersonaTrainingState(
  db: PrismaClient,
  persona: { id: string; status: string; avatarTrainingTaskId: string | null },
): Promise<PersonaTrainingState> {
  if (persona.status !== "processing") return { status: "active", progress: 100 };

  if (!persona.avatarTrainingTaskId) {
    // Nothing to wait on (no video/facial-scan asset) — done immediately.
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
    return { status: "processing", progress: task?.progress ?? 0 };
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
