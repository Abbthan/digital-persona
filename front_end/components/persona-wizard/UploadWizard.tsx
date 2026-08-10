"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "@/front_end/components/ui";
import { useAuth } from "@/front_end/state/auth-context";
import { hasPaidAccess } from "@/back_end/services/limits";
import { PERSONA_UPLOAD_LIMITS, planLimit } from "@/shared/persona-upload-limits";
import { useModalController } from "@/front_end/state/modal-context";
import { useLocale } from "@/front_end/state/locale-context";
import type { PersonaSettingsResponseBody } from "@/back_end/api/personas/[id]/route";
import { DialectSlider, type SttDialectPreference } from "./DialectSlider";
import { normalizeSttLanguagePreference } from "@/shared/stt-language";
import { FileUploadTile } from "./FileUploadTile";
import { PassiveFacialScanTile } from "./PassiveFacialScanTile";
import { PersonaAssetList } from "./PersonaAssetList";
import { RecordingWithTalkingTile } from "./RecordingWithTalkingTile";
import { SocialLinkTile } from "./SocialLinkTile";

type UploadWizardProps = {
  open: boolean;
  personaId: string;
  personaName: string;
  onFinish: () => void;
  onCancel: () => void;
};

export function UploadWizard({ open, personaId, personaName, onFinish, onCancel }: UploadWizardProps) {
  const { user } = useAuth();
  const { locale } = useLocale();
  const { openModal } = useModalController();
  const isPaid = hasPaidAccess(user?.subscription.status, user?.subscription.currentPeriodEnd);
  const photoLimit = planLimit(PERSONA_UPLOAD_LIMITS.image, isPaid);
  const documentLimit = planLimit(PERSONA_UPLOAD_LIMITS.document, isPaid);
  const audioUploadLimit = planLimit(PERSONA_UPLOAD_LIMITS.audioUpload, isPaid);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assetRefreshVersion, setAssetRefreshVersion] = useState(0);
  const [dialectPreference, setDialectPreference] = useState<SttDialectPreference>("mandarin");
  const [dialectSaving, setDialectSaving] = useState(false);
  const [dialectError, setDialectError] = useState<string | null>(null);
  // See PersonaManagerModal.tsx's identical guard: a fast slider click can
  // race the initial GET below, whose late response would otherwise
  // overwrite the just-saved value with the pre-change one.
  const dialectUserEditedRef = useRef(false);

  useEffect(() => {
    dialectUserEditedRef.current = false;
    let cancelled = false;
    fetch(`/api/personas/${personaId}`)
      .then((response) => response.json() as Promise<PersonaSettingsResponseBody>)
      .then((result) => {
        if (!cancelled && !dialectUserEditedRef.current && result.ok) {
          setDialectError(null);
          setDialectPreference(normalizeSttLanguagePreference(result.persona.sttDialectPreference));
        }
      })
      .catch(() => {
        // Keeps the "mandarin" default.
      });
    return () => {
      cancelled = true;
    };
  }, [personaId]);

  async function handleDialectChange(next: SttDialectPreference) {
    dialectUserEditedRef.current = true;
    const previous = dialectPreference;
    setDialectPreference(next);
    setDialectSaving(true);
    setDialectError(null);
    try {
      const response = await fetch(`/api/personas/${personaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sttDialectPreference: next }),
      });
      const result = await response.json().catch(() => null) as PersonaSettingsResponseBody | null;
      if (!result) {
        setDialectPreference(previous);
        setDialectError(locale === "zh"
          ? `无法保存语音语言（${response.status || "网络错误"}）。`
          : `Couldn't save the speech language (${response.status || "network error"}).`);
        return;
      }
      if (!response.ok || !result.ok) {
        setDialectPreference(previous);
        setDialectError(result.ok
          ? (locale === "zh" ? "无法保存语音语言。" : "Couldn't save the speech language.")
          : result.error);
      } else {
        setDialectPreference(normalizeSttLanguagePreference(result.persona.sttDialectPreference));
      }
    } catch {
      setDialectPreference(previous);
      setDialectError(locale === "zh" ? "无法保存语音语言，请重试。" : "Couldn't save the speech language. Please try again.");
    } finally {
      setDialectSaving(false);
    }
  }

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

        <div className="mt-lg rounded-md border border-hairline bg-canvas-parchment p-sm">
          <p className="font-text text-caption-strong text-ink">Speech language</p>
          <p className="mt-xxs font-text text-fine-print text-ink-muted-48">
            Chooses the language and recognition model used for live speech.
          </p>
          <DialectSlider value={dialectPreference} onChange={handleDialectChange} />
          {dialectSaving && <p className="mt-xs font-text text-fine-print text-ink-muted-48">Saving…</p>}
          {dialectError && <p role="alert" className="mt-xs font-text text-fine-print text-red-500">{dialectError}</p>}
        </div>

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
          <RecordingWithTalkingTile
            personaId={personaId}
            personaName={personaName}
            locked={!isPaid}
            onLockedClick={openPricing}
            onUploaded={handleAssetUploaded}
            deferTraining
          />
          <PassiveFacialScanTile
            personaId={personaId}
            locked={!isPaid}
            onLockedClick={openPricing}
            onUploaded={handleAssetUploaded}
            deferTraining
          />
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
