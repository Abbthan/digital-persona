"use client";

import { ChangeEvent, DragEvent, useRef, useState } from "react";
import type { AssetType } from "@/generated/prisma/client";
import type { ListAssetsResponseBody, PersonaAssetDTO } from "@/back_end/api/personas/[id]/assets/route";
import { uploadPersonaAsset } from "@/front_end/state/persona-client";
import { cn } from "@/shared/utils";
import { UploadTileShell } from "./UploadTileShell";

type FileUploadTileProps = {
  personaId: string;
  type: AssetType;
  label: string;
  description: string;
  accept: string;
  maxSizeBytes?: number;
  maxFiles?: number;
  multiple?: boolean;
  locked?: boolean;
  onLockedClick?: () => void;
  onUploaded?: () => void;
};

export function FileUploadTile({
  personaId,
  type,
  label,
  description,
  accept,
  maxSizeBytes,
  maxFiles,
  multiple,
  locked,
  onLockedClick,
  onUploaded,
}: FileUploadTileProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [count, setCount] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function countsTowardThisTile(asset: PersonaAssetDTO) {
    if (asset.type !== type) return false;
    // Audio recorder captures have their own one-recording limit and should
    // not consume a slot from the separate audio-file upload allowance.
    if (type === "audio") return asset.source !== "audio_recording";
    // A live facial scan saves a dedicated motion-reference clip. It has its
    // own one-scan ceiling and should not consume one of the three ordinary
    // video-upload slots.
    if (type === "video") return asset.source !== "facial_camera";
    return true;
  }

  async function currentFileCount() {
    const response = await fetch(`/api/personas/${personaId}/assets`, { cache: "no-store" });
    const result = await response.json() as ListAssetsResponseBody;
    if (!result.ok) throw new Error(result.error);
    return result.assets.filter(countsTowardThisTile).length;
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    const selectedFiles = Array.from(files);
    if (maxFiles !== undefined) {
      try {
        const current = await currentFileCount();
        const remaining = Math.max(0, maxFiles - current);
        if (selectedFiles.length > remaining) {
          setError(
            remaining === 0
              ? `You've reached this persona's limit of ${maxFiles} ${label.toLowerCase()}. Delete an existing file to add another.`
              : `You can add ${remaining} more ${label.toLowerCase()} file${remaining === 1 ? "" : "s"}. Choose no more than ${remaining} at once.`,
          );
          setUploading(false);
          if (inputRef.current) inputRef.current.value = "";
          return;
        }
      } catch {
        // The server independently enforces every ceiling, so a temporary
        // count read failure cannot let an over-limit upload through.
      }
    }
    let uploaded = false;
    for (const file of selectedFiles) {
      if (maxSizeBytes && file.size > maxSizeBytes) {
        setError(`${file.name} is larger than the ${Math.round(maxSizeBytes / (1024 * 1024))} MB limit.`);
        continue;
      }
      const result = await uploadPersonaAsset(personaId, file, type);
      if (result.ok) {
        uploaded = true;
        setCount((current) => current + 1);
      } else {
        setError(result.error);
      }
    }
    setUploading(false);
    if (uploaded) onUploaded?.();
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragOver(false);
    handleFiles(event.dataTransfer.files);
  }

  return (
    <UploadTileShell
      label={label}
      description={description}
      locked={locked}
      onLockedClick={onLockedClick}
    >
      <button
        type="button"
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex h-20 w-full items-center justify-center rounded-md border border-dashed px-sm text-center font-text text-caption transition-colors",
          dragOver ? "border-primary text-primary" : "border-hairline text-ink-muted-48",
        )}
      >
        {uploading
          ? "Uploading…"
          : count > 0
            ? `${count} added — add more`
            : "Drag & drop or click to choose"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(event: ChangeEvent<HTMLInputElement>) => handleFiles(event.target.files)}
      />
      {error && <p role="alert" className="font-text text-caption text-red-500">{error}</p>}
    </UploadTileShell>
  );
}
