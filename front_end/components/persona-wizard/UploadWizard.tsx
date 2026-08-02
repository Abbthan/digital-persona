"use client";

import { useState } from "react";
import { Button, Modal } from "@/front_end/components/ui";
import { useAuth } from "@/front_end/state/auth-context";
import { hasPaidAccess } from "@/back_end/services/limits";
import { PERSONA_UPLOAD_LIMITS, planLimit } from "@/shared/persona-upload-limits";
import { useModalController } from "@/front_end/state/modal-context";
import { AudioRecorderTile } from "./AudioRecorderTile";
import { FacialScanTile } from "./FacialScanTile";
import { FileUploadTile } from "./FileUploadTile";
import { PersonaAssetList } from "./PersonaAssetList";
import { SocialLinkTile } from "./SocialLinkTile";
import { VideoRecorderTile } from "./VideoRecorderTile";

type UploadWizardProps = {
  open: boolean;
  personaId: string;
  personaName: string;
  onFinish: () => void;
  onCancel: () => void;
};

export function UploadWizard({ open, personaId, personaName, onFinish, onCancel }: UploadWizardProps) {
  const { user } = useAuth();
  const { openModal } = useModalController();
  const isPaid = hasPaidAccess(user?.subscription.status, user?.subscription.currentPeriodEnd);
  const photoLimit = planLimit(PERSONA_UPLOAD_LIMITS.image, isPaid);
  const documentLimit = planLimit(PERSONA_UPLOAD_LIMITS.document, isPaid);
  const audioUploadLimit = planLimit(PERSONA_UPLOAD_LIMITS.audioUpload, isPaid);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assetRefreshVersion, setAssetRefreshVersion] = useState(0);

  function openPricing() {
    openModal("pricing", { pricingReason: "This upload type needs a subscription." });
  }

  async function handleDone() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/personas/${personaId}/finish`, { method: "POST" });
      const result = await response.json() as { ok: boolean; error?: string };
      if (!result.ok) {
        setError(result.error ?? "Couldn't finish persona setup. Please try again.");
        return;
      }
      onFinish();
    } catch {
      setError("Couldn't finish persona setup. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/personas/${personaId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discardDraft: true }),
      });
      const result = await response.json() as { ok: boolean; error?: string };
      if (!result.ok) {
        setError(result.error ?? "Couldn't discard this draft. Please try again.");
        return;
      }
      onCancel();
    } catch {
      setError("Couldn't discard this draft. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleAssetUploaded() {
    setAssetRefreshVersion((version) => version + 1);
  }

  return (
    <Modal
      open={open}
      onClose={handleCancel}
      maxWidthClassName="max-w-[56rem]"
      className="flex max-h-[calc(100dvh-3rem)] flex-col overflow-hidden"
    >
      <h2 className="flex-shrink-0 font-display text-tagline text-ink">Add what you have</h2>
      <div className="mt-lg min-h-0 flex-1 overflow-y-auto overscroll-contain pr-xs">
        <p className="font-text text-caption text-ink-muted-80">
          Upload as much or as little as you like — you can always add more later.
        </p>

        <p className="mt-lg font-text text-caption-strong text-ink-muted-48">Media</p>
        <div className="mt-xs grid grid-cols-1 gap-sm sm:grid-cols-2">
          <FileUploadTile
            personaId={personaId}
            type="image"
            label="Photos"
            description={`Up to ${photoLimit} JPG or PNG photos, 5 MB each`}
            accept=".jpg,.jpeg,.png,image/jpeg,image/png"
            maxSizeBytes={PERSONA_UPLOAD_LIMITS.image.maxBytes}
            maxFiles={photoLimit}
            multiple
            onUploaded={handleAssetUploaded}
          />
          <FileUploadTile
            personaId={personaId}
            type="video"
            label="Video"
            description={isPaid ? "Up to 3 MP4 or MOV videos, 20 MB each" : "Requires a subscription"}
            accept=".mp4,.mov,video/mp4,video/quicktime"
            maxSizeBytes={PERSONA_UPLOAD_LIMITS.video.maxBytes}
            maxFiles={PERSONA_UPLOAD_LIMITS.video.max}
            locked={!isPaid}
            onLockedClick={openPricing}
            onUploaded={handleAssetUploaded}
          />
          <VideoRecorderTile personaId={personaId} locked={!isPaid} onLockedClick={openPricing} onUploaded={handleAssetUploaded} />
          <FacialScanTile personaId={personaId} personaName={personaName} locked={!isPaid} onLockedClick={openPricing} onUploaded={handleAssetUploaded} />
          <FileUploadTile
            personaId={personaId}
            type="audio"
            label="Audio upload"
            description={`Up to ${audioUploadLimit} MP3 or WAV files, 1 MB each`}
            accept=".mp3,.wav,audio/mpeg,audio/wav"
            maxSizeBytes={1 * 1024 * 1024}
            maxFiles={audioUploadLimit}
            multiple
            onUploaded={handleAssetUploaded}
          />
          <AudioRecorderTile personaId={personaId} personaName={personaName} onUploaded={handleAssetUploaded} />
        </div>

        <p className="mt-lg font-text text-caption-strong text-ink-muted-48">Text &amp; Links</p>
        <div className="mt-xs grid grid-cols-1 gap-sm sm:grid-cols-2">
          <SocialLinkTile personaId={personaId} onAdded={handleAssetUploaded} />
          <FileUploadTile
            personaId={personaId}
            type="text"
            label="Documents"
            description={`Up to ${documentLimit} PDF, TXT, or DOCX documents, 5 MB each`}
            accept=".txt,.docx,.pdf,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            multiple
            maxSizeBytes={PERSONA_UPLOAD_LIMITS.document.maxBytes}
            maxFiles={documentLimit}
            onUploaded={handleAssetUploaded}
          />
        </div>

        <PersonaAssetList personaId={personaId} refreshToken={assetRefreshVersion} />

        {error && <p role="alert" className="mt-lg font-text text-caption text-red-500">{error}</p>}
        <Button variant="primary" className="mt-lg w-full" onClick={handleDone} disabled={submitting}>
          {submitting ? "Saving…" : "Done"}
        </Button>
      </div>
    </Modal>
  );
}
