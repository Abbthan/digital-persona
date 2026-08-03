import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import type { AssetType } from "@/generated/prisma/client";
import { getCurrentUser } from "@/back_end/services/auth";
import { getDb } from "@/back_end/services/db";
import { hasPaidAccess, isAssetTypeAllowed } from "@/back_end/services/limits";
import {
  failPersonaTrainingStart,
  PERSONA_TRAINING_STARTING_TASK_ID,
  startPersonaTraining,
  TRAINING_RELEVANT_ASSET_TYPES,
} from "@/back_end/services/persona-training";
import { ingestDocument } from "@/back_end/services/persona-rag";
import { deletePersonaMedia, uploadPersonaMedia } from "@/back_end/services/storage";
import { isDedicatedFacialVideoSource, PERSONA_ASSET_SOURCES } from "@/shared/persona-asset-sources";
import { PERSONA_UPLOAD_LIMITS, planLimit } from "@/shared/persona-upload-limits";

const UPLOADABLE_TYPES: AssetType[] = ["image", "video", "audio", "text", "facial_scan"];
const ALLOWED_SOURCES = new Set<string>(Object.values(PERSONA_ASSET_SOURCES));
function extensionOf(file: File) {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

function fileValidationError(file: File, type: AssetType, source: string): string | null {
  const extension = extensionOf(file);
  if (type === "image" && file.size > PERSONA_UPLOAD_LIMITS.image.maxBytes) {
    return "Each photo must be 5 MB or smaller.";
  }
  if (type === "audio" && file.size > PERSONA_UPLOAD_LIMITS.audioUpload.maxBytes) {
    return "Each audio file must be 1 MB or smaller.";
  }
  if (type === "video" && file.size > PERSONA_UPLOAD_LIMITS.video.maxBytes) {
    return "Each video must be 20 MB or smaller.";
  }
  if (type === "text" && file.size > PERSONA_UPLOAD_LIMITS.document.maxBytes) {
    return "Each document must be 5 MB or smaller.";
  }
  if (type === "image" && !["jpg", "jpeg", "png"].includes(extension)) {
    return "Photos must be JPG or PNG files.";
  }
  if (type === "video") {
    if (
      (source === PERSONA_ASSET_SOURCES.legacyCameraRecording || isDedicatedFacialVideoSource(source)) &&
      extension === "webm"
    ) return null;
    if (!["mp4", "mov"].includes(extension)) return "Videos must be MP4 or MOV files.";
  }
  if (type === "audio") {
    if (source === "audio_recording" && ["webm", "m4a", "mp4"].includes(extension)) return null;
    if (!["mp3", "wav"].includes(extension)) return "Audio files must be MP3 or WAV files.";
  }
  if (type === "text" && !["pdf", "txt", "docx"].includes(extension)) {
    return "Documents must be PDF, TXT, or DOCX files.";
  }
  if (type === "facial_scan" && !["jpg", "jpeg", "png"].includes(extension)) {
    return "Facial scans must be captured as JPG or PNG images.";
  }
  return null;
}

function metadataSource(metadata: unknown) {
  return metadata && typeof metadata === "object" && "source" in metadata
    ? (metadata as { source?: unknown }).source
    : "upload";
}

function assetLimitError(
  assets: { type: AssetType; metadata: unknown }[],
  type: AssetType,
  source: string,
  isPaid: boolean,
): string | null {
  const count = (predicate: (asset: { type: AssetType; metadata: unknown }) => boolean) => assets.filter(predicate).length;
  if (type === "image" && count((asset) => asset.type === "image") >= planLimit(PERSONA_UPLOAD_LIMITS.image, isPaid)) {
    return `You can upload up to ${planLimit(PERSONA_UPLOAD_LIMITS.image, isPaid)} photos per persona.`;
  }
  if (type === "text" && count((asset) => asset.type === "text") >= planLimit(PERSONA_UPLOAD_LIMITS.document, isPaid)) {
    return `You can upload up to ${planLimit(PERSONA_UPLOAD_LIMITS.document, isPaid)} documents per persona.`;
  }
  if (type === "facial_scan" && count((asset) => asset.type === "facial_scan") >= PERSONA_UPLOAD_LIMITS.facialScan.max) {
    return "You can add one facial scan per persona.";
  }
  if (type === "video" && source === PERSONA_ASSET_SOURCES.guidedFacialScan && count((asset) => asset.type === "video" && metadataSource(asset.metadata) === PERSONA_ASSET_SOURCES.guidedFacialScan) >= PERSONA_UPLOAD_LIMITS.facialScan.max) {
    return "You can add one guided facial scan per persona.";
  }
  if (type === "video" && source === PERSONA_ASSET_SOURCES.passiveFacialScan && count((asset) => asset.type === "video" && metadataSource(asset.metadata) === PERSONA_ASSET_SOURCES.passiveFacialScan) >= PERSONA_UPLOAD_LIMITS.passiveFacialScan.max) {
    return "You can add one passive facial scan per persona.";
  }
  if (type === "video" && !isDedicatedFacialVideoSource(source) && count((asset) => asset.type === "video" && !isDedicatedFacialVideoSource(metadataSource(asset.metadata))) >= PERSONA_UPLOAD_LIMITS.video.max) {
    return `You can upload up to ${PERSONA_UPLOAD_LIMITS.video.max} videos per persona.`;
  }
  if (type === "audio" && source === "audio_recording" && count((asset) => asset.type === "audio" && metadataSource(asset.metadata) === "audio_recording") >= PERSONA_UPLOAD_LIMITS.audioRecording.max) {
    return "You can save one audio recording per persona.";
  }
  if (type === "audio" && source !== "audio_recording" && count((asset) => asset.type === "audio" && metadataSource(asset.metadata) !== "audio_recording") >= planLimit(PERSONA_UPLOAD_LIMITS.audioUpload, isPaid)) {
    return `You can upload up to ${planLimit(PERSONA_UPLOAD_LIMITS.audioUpload, isPaid)} audio files per persona.`;
  }
  return null;
}

export type UploadAssetResponseBody =
  | { ok: true; asset: { id: string; type: AssetType } }
  | { ok: false; error: string };

export type PersonaAssetDTO = {
  id: string;
  type: AssetType;
  source: string;
  name: string;
  size: number | null;
  createdAt: string;
};

export type ListAssetsResponseBody =
  | { ok: true; assets: PersonaAssetDTO[] }
  | { ok: false; error: string };

function assetMetadata(metadata: unknown): { originalName?: unknown; size?: unknown; source?: unknown } {
  return metadata && typeof metadata === "object" ? metadata as { originalName?: unknown; size?: unknown } : {};
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const db = getDb();
  const user = await getCurrentUser().catch(() => null);
  if (!user || !user.emailVerified) {
    return NextResponse.json<ListAssetsResponseBody>(
      { ok: false, error: "You're not logged in." },
      { status: 401 },
    );
  }

  const { id: personaId } = await params;
  try {
    const persona = await db.persona.findFirst({ where: { id: personaId, userId: user.id } });
    if (!persona) {
      return NextResponse.json<ListAssetsResponseBody>(
        { ok: false, error: "Persona not found." },
        { status: 404 },
      );
    }

    const assets = await db.personaAsset.findMany({
      where: { personaId },
      orderBy: { createdAt: "desc" },
      select: { id: true, type: true, metadata: true, createdAt: true },
    });

    return NextResponse.json<ListAssetsResponseBody>({
      ok: true,
      assets: assets.map((asset) => {
        const metadata = assetMetadata(asset.metadata);
        return {
          id: asset.id,
          type: asset.type,
          source: typeof metadata.source === "string" ? metadata.source : "upload",
          name: typeof metadata.originalName === "string" ? metadata.originalName : "Untitled upload",
          size: typeof metadata.size === "number" ? metadata.size : null,
          createdAt: asset.createdAt.toISOString(),
        };
      }),
    });
  } catch (error) {
    console.error("GET /api/personas/[id]/assets failed", error);
    return NextResponse.json<ListAssetsResponseBody>(
      { ok: false, error: "Couldn't load uploads — the database isn't reachable yet." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const db = getDb();
  const user = await getCurrentUser().catch(() => null);
  if (!user || !user.emailVerified) {
    return NextResponse.json<UploadAssetResponseBody>(
      { ok: false, error: "You're not logged in." },
      { status: 401 },
    );
  }

  const { id: personaId } = await params;
  console.info("[persona-upload] request received", {
    personaId,
    contentType: request.headers.get("content-type")?.split(";", 1)[0] ?? "unknown",
  });
  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const typeValue = formData?.get("type");
  const sourceValue = formData?.get("source");

  if (
    !(file instanceof File) ||
    typeof typeValue !== "string" ||
    !UPLOADABLE_TYPES.includes(typeValue as AssetType)
  ) {
    return NextResponse.json<UploadAssetResponseBody>(
      { ok: false, error: "Missing file or invalid asset type." },
      { status: 400 },
    );
  }
  const type = typeValue as AssetType;
  const source = typeof sourceValue === "string" && ALLOWED_SOURCES.has(sourceValue) ? sourceValue : "upload";
  const replaceExisting = formData?.get("replaceExisting") === "true";
  const deferTraining = formData?.get("deferTraining") === "true";

  console.info("[persona-upload] parsed", {
    personaId,
    type,
    source,
    fileName: file.name,
    mimeType: file.type,
    bytes: file.size,
    replaceExisting,
    deferTraining,
  });

  const validationError = fileValidationError(file, type, source);
  if (validationError) {
    return NextResponse.json<UploadAssetResponseBody>({ ok: false, error: validationError }, { status: 400 });
  }

  if (!isAssetTypeAllowed(type, user.subscriptionStatus, user.subscriptionRenewsAt)) {
    return NextResponse.json<UploadAssetResponseBody>(
      { ok: false, error: "This upload type requires a subscription." },
      { status: 403 },
    );
  }

  try {
    const persona = await db.persona.findFirst({ where: { id: personaId, userId: user.id } });
    if (!persona) {
      return NextResponse.json<UploadAssetResponseBody>(
        { ok: false, error: "Persona not found." },
        { status: 404 },
      );
    }

    const existingAssets = await db.personaAsset.findMany({
      where: { personaId },
      select: { id: true, type: true, url: true, metadata: true },
    });
    const replaceableAsset = replaceExisting
      ? existingAssets.find((asset) => (
        asset.type === type &&
        (
          type === "facial_scan" ||
          (type === "video" && isDedicatedFacialVideoSource(source) && metadataSource(asset.metadata) === source) ||
          (type === "audio" && source === "audio_recording" && metadataSource(asset.metadata) === "audio_recording")
        )
      ))
      : undefined;
    const limitError = assetLimitError(
      replaceableAsset ? existingAssets.filter((asset) => asset.id !== replaceableAsset.id) : existingAssets,
      type,
      source,
      hasPaidAccess(user.subscriptionStatus, user.subscriptionRenewsAt),
    );
    if (limitError) {
      return NextResponse.json<UploadAssetResponseBody>({ ok: false, error: limitError }, { status: 400 });
    }

    const { path } = await uploadPersonaMedia(personaId, file);
    console.info("[persona-upload] R2 stream stored", { personaId, type, bytes: file.size });

    const asset = replaceableAsset
      ? await db.personaAsset.update({
        where: { id: replaceableAsset.id },
        data: { url: path, metadata: { originalName: file.name, size: file.size, mimeType: file.type, source } },
        select: { id: true, type: true },
      })
      : await db.personaAsset.create({
        data: {
          personaId,
          type,
          url: path,
          metadata: { originalName: file.name, size: file.size, mimeType: file.type, source },
        },
        select: { id: true, type: true },
      });

    console.info("[persona-upload] asset persisted", {
      personaId,
      assetId: asset.id,
      type: asset.type,
      replacedAssetId: replaceableAsset?.id ?? null,
    });

    if (replaceableAsset) deletePersonaMedia(replaceableAsset.url).catch(() => {});

    // Uploading a photo/document/link doesn't affect the trained avatar or
    // voice — only retrain for the asset types that actually feed them, and
    // only once the persona already exists (the creation wizard trains once
    // at the end via /finish instead, since intermediate uploads there
    // aren't a "submit" yet).
    if (!deferTraining && persona.status === "active" && TRAINING_RELEVANT_ASSET_TYPES.includes(type)) {
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
      console.info("[persona-training] queued after upload", { personaId, assetId: asset.id, type });
      after(async () => {
        try {
          await startPersonaTraining(db, personaId);
        } catch (trainingError) {
          console.error("Background persona training start failed", trainingError);
          await failPersonaTrainingStart(db, personaId, trainingError).catch((stateError) => {
            console.error("Couldn't finalize failed persona training", stateError);
          });
        }
      });
    }

    // Documents feed the persona's RAG memory, not the avatar/voice
    // pipeline above — a failed ingest here shouldn't fail the upload
    // itself, so this is deliberately unchecked.
    if (type === "text") {
      const assetName = file.name;
      console.info("[persona-rag] queued after upload", { personaId, assetId: asset.id });
      after(async () => {
        try {
          await ingestDocument(personaId, asset.id, assetName);
        } catch (ragError) {
          console.error("Background document ingestion start failed", ragError);
        }
      });
    }

    return NextResponse.json<UploadAssetResponseBody>({ ok: true, asset });
  } catch (error) {
    console.error("POST /api/personas/[id]/assets failed", error);
    return NextResponse.json<UploadAssetResponseBody>(
      { ok: false, error: "Couldn't upload — the database or storage isn't reachable yet." },
      { status: 500 },
    );
  }
}
