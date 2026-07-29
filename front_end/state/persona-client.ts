"use client";

import type { AssetType } from "@/generated/prisma/client";
import type { UploadAssetResponseBody } from "@/back_end/api/personas/[id]/assets/route";

export async function uploadPersonaAsset(
  personaId: string,
  file: File,
  type: AssetType,
  source = "upload",
  replaceExisting = false,
  deferTraining = false,
): Promise<UploadAssetResponseBody> {
  // Keep browser diagnostics deliberately metadata-only: filenames, MIME
  // types and byte counts are enough to correlate an upload with server logs
  // without ever exposing the media contents in a console.
  console.info("[persona-upload] starting", {
    personaId,
    type,
    source,
    fileName: file.name,
    mimeType: file.type,
    bytes: file.size,
    replaceExisting,
    deferTraining,
  });
  const formData = new FormData();
  formData.append("file", file);
  formData.append("type", type);
  formData.append("source", source);
  if (replaceExisting) formData.append("replaceExisting", "true");
  if (deferTraining) formData.append("deferTraining", "true");
  try {
    const response = await fetch(`/api/personas/${personaId}/assets`, {
      method: "POST",
      body: formData,
    });
    const result = await response.json().catch(() => null) as UploadAssetResponseBody | null;

    if (!response.ok || !result) {
      const error = result && !result.ok
        ? result.error
        : `Upload failed with status ${response.status}. Please try again.`;
      console.error("[persona-upload] failed", { personaId, type, source, status: response.status, error });
      return { ok: false, error };
    }

    if (result.ok) {
      console.info("[persona-upload] stored", { personaId, type, source, assetId: result.asset.id });
    } else {
      console.error("[persona-upload] rejected", { personaId, type, source, error: result.error });
    }
    return result;
  } catch (error) {
    console.error("[persona-upload] network failure", { personaId, type, source, error });
    return { ok: false, error: "Couldn't reach the upload service. Please try again." };
  }
}
