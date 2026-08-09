"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Modal } from "@/front_end/components/ui";
import { useAuth } from "@/front_end/state/auth-context";
import { hasPaidAccess } from "@/back_end/services/limits";
import { PERSONA_UPLOAD_LIMITS, planLimit } from "@/shared/persona-upload-limits";
import { useModalController } from "@/front_end/state/modal-context";
import { useLocale } from "@/front_end/state/locale-context";
import type { DeleteAssetResponseBody } from "@/back_end/api/personas/[id]/assets/[assetId]/route";
import type { ListAssetsResponseBody, PersonaAssetDTO } from "@/back_end/api/personas/[id]/assets/route";
import type { DeletePersonaResponseBody, PersonaSettingsResponseBody } from "@/back_end/api/personas/[id]/route";
import { DialectSlider, type SttDialectPreference } from "@/front_end/components/persona-wizard/DialectSlider";
import { FileUploadTile } from "@/front_end/components/persona-wizard/FileUploadTile";
import { PassiveFacialScanTile } from "@/front_end/components/persona-wizard/PassiveFacialScanTile";
import { PersonaAssetList } from "@/front_end/components/persona-wizard/PersonaAssetList";
import { RecordingWithTalkingTile } from "@/front_end/components/persona-wizard/RecordingWithTalkingTile";
import { SocialLinkTile } from "@/front_end/components/persona-wizard/SocialLinkTile";

type PersonaManagerModalProps = {
  persona: { id: string; name: string } | null;
  onClose: () => void;
  onPersonaDeleted: (personaId: string) => void;
};

type SortOrder = "date" | "name";
type Confirmation = { kind: "assets"; assetIds: string[] } | { kind: "persona" } | null;

function formatFileSize(size: number | null) {
  if (size === null) return "Unknown size";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatAssetType(type: PersonaAssetDTO["type"]) {
  return type.replaceAll("_", " ");
}

export function PersonaManagerModal({ persona, onClose, onPersonaDeleted }: PersonaManagerModalProps) {
  const [assets, setAssets] = useState<PersonaAssetDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assetsExpanded, setAssetsExpanded] = useState(true);
  const [sortOrder, setSortOrder] = useState<SortOrder>("date");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [deleting, setDeleting] = useState(false);
  const [personaDeleteCountdown, setPersonaDeleteCountdown] = useState(0);
  const [personaPassword, setPersonaPassword] = useState("");
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [assetRefreshVersion, setAssetRefreshVersion] = useState(0);
  const [dialectPreference, setDialectPreference] = useState<SttDialectPreference>("mandarin");
  const [dialectSaving, setDialectSaving] = useState(false);
  const [dialectError, setDialectError] = useState<string | null>(null);
  // The initial GET-on-open fetch below and a fast slider click can race:
  // if the user changes the preference before that GET resolves, its
  // response still carries the pre-change value and would otherwise
  // overwrite the just-saved one once it lands — the slider "bounces back"
  // even though the save itself succeeded. Once the user has touched the
  // slider this session, that stale GET result is no longer trustworthy.
  const dialectUserEditedRef = useRef(false);
  const { user } = useAuth();
  const { locale } = useLocale();
  const { openModal } = useModalController();
  const isPaid = hasPaidAccess(user?.subscription.status, user?.subscription.currentPeriodEnd);
  const photoLimit = planLimit(PERSONA_UPLOAD_LIMITS.image, isPaid);
  const documentLimit = planLimit(PERSONA_UPLOAD_LIMITS.document, isPaid);
  const audioUploadLimit = planLimit(PERSONA_UPLOAD_LIMITS.audioUpload, isPaid);

  useEffect(() => {
    if (!persona) return;
    let cancelled = false;

    fetch(`/api/personas/${persona.id}/assets`)
      .then((response) => response.json() as Promise<ListAssetsResponseBody>)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setAssets(result.assets);
        else setError(result.error);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load uploads. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [persona, assetRefreshVersion]);

  useEffect(() => {
    if (!persona) return;
    dialectUserEditedRef.current = false;
    let cancelled = false;
    fetch(`/api/personas/${persona.id}`)
      .then((response) => response.json() as Promise<PersonaSettingsResponseBody>)
      .then((result) => {
        if (!cancelled && !dialectUserEditedRef.current && result.ok) {
          setDialectError(null);
          setDialectPreference(result.persona.sttDialectPreference === "wu" ? "wu" : "mandarin");
        }
      })
      .catch(() => {
        // Keeps the "mandarin" default — the slider still works, it just
        // won't reflect a previously-saved "wu" preference until reopened.
      });
    return () => {
      cancelled = true;
    };
  }, [persona]);

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
        setDialectPreference(result.persona.sttDialectPreference === "wu" ? "wu" : "mandarin");
      }
    } catch {
      setDialectPreference(previous);
      setDialectError(locale === "zh" ? "无法保存语音语言，请重试。" : "Couldn't save the speech language. Please try again.");
    } finally {
      setDialectSaving(false);
    }
  }

  useEffect(() => {
    if (confirmation?.kind !== "persona" || personaDeleteCountdown <= 0) return;
    const timeout = window.setTimeout(() => setPersonaDeleteCountdown((seconds) => seconds - 1), 1_000);
    return () => window.clearTimeout(timeout);
  }, [confirmation, personaDeleteCountdown]);

  const sortedAssets = useMemo(() => [...assets].sort((first, second) => {
    if (sortOrder === "name") return first.name.localeCompare(second.name);
    return new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime();
  }), [assets, sortOrder]);

  if (!persona) return null;
  const personaId = persona.id;

  function toggleAssetSelection(assetId: string) {
    setSelectedAssetIds((selected) => (
      selected.includes(assetId)
        ? selected.filter((id) => id !== assetId)
        : [...selected, assetId]
    ));
  }

  function toggleSelectionMode() {
    setSelectionMode((active) => !active);
    setSelectedAssetIds([]);
  }

  function requestPersonaDeletion() {
    setPersonaDeleteCountdown(3);
    setPersonaPassword("");
    setConfirmationError(null);
    setConfirmation({ kind: "persona" });
  }

  function closeConfirmation() {
    setConfirmation(null);
    setConfirmationError(null);
    setPersonaPassword("");
  }

  function handleAssetUploaded() {
    setLoading(true);
    setAssetRefreshVersion((version) => version + 1);
  }

  function openPricing() {
    openModal("pricing", { pricingReason: "This upload type needs a subscription." });
  }

  async function deleteAssets(assetIds: string[]) {
    setDeleting(true);
    setError(null);
    try {
      const results = await Promise.all(assetIds.map(async (assetId) => {
        const response = await fetch(`/api/personas/${personaId}/assets/${assetId}`, { method: "DELETE" });
        return response.json() as Promise<DeleteAssetResponseBody>;
      }));
      const failure = results.find((result) => !result.ok);
      if (failure && !failure.ok) {
        setError(failure.error);
        return;
      }
      setAssets((current) => current.filter((asset) => !assetIds.includes(asset.id)));
      setSelectedAssetIds((selected) => selected.filter((assetId) => !assetIds.includes(assetId)));
      setConfirmation(null);
    } catch {
      setError("Couldn't delete the selected upload. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  async function deletePersona() {
    setDeleting(true);
    setConfirmationError(null);
    try {
      const response = await fetch(`/api/personas/${personaId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: personaPassword }),
      });
      const result = await response.json() as DeletePersonaResponseBody;
      if (!result.ok) {
        setConfirmationError(result.error);
        return;
      }
      closeConfirmation();
      onPersonaDeleted(personaId);
    } catch {
      setConfirmationError("Couldn't delete this persona. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        maxWidthClassName="max-w-[56rem]"
        className="flex max-h-[calc(100dvh-3rem)] flex-col overflow-hidden"
      >
        <div className="flex flex-shrink-0 items-center gap-sm pr-xl">
          <h2 className="truncate font-display text-tagline text-ink">Manage {persona.name}</h2>
        </div>

        <div className="mt-lg min-h-0 flex-1 overflow-y-auto overscroll-contain pr-xs">
          <section>
            <p className="font-text text-body-strong text-ink">Add more files</p>
            <p className="mt-xs font-text text-caption text-ink-muted-80">
              Add to this persona at any time. Your existing chat history and uploads are kept.
            </p>

            <div className="mt-lg rounded-md border border-hairline bg-canvas-parchment p-sm">
              <p className="font-text text-caption-strong text-ink">Speech language</p>
              <p className="mt-xxs font-text text-fine-print text-ink-muted-48">
                Chooses which speech-to-text engine handles this persona&apos;s Chinese conversations.
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
                personaName={persona.name}
                locked={!isPaid}
                onLockedClick={openPricing}
                onUploaded={handleAssetUploaded}
              />
              <PassiveFacialScanTile
                personaId={personaId}
                locked={!isPaid}
                onLockedClick={openPricing}
                onUploaded={handleAssetUploaded}
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
          </section>

          <PersonaAssetList personaId={personaId} refreshToken={assetRefreshVersion} />

          {/* Kept temporarily as the original markup while the shared list
              above owns the visible experience for both create and edit. */}
          <div className="hidden" aria-hidden="true">
            <div className="flex items-center justify-between gap-sm">
              <button
                type="button"
                onClick={() => setAssetsExpanded((expanded) => !expanded)}
                aria-expanded={assetsExpanded}
                className="flex min-w-0 items-center gap-xs text-left"
              >
                <span className="font-text text-body-strong text-ink">Uploads ({assets.length})</span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path
                    d={assetsExpanded ? "M2 7L6 3L10 7" : "M2 5L6 9L10 5"}
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                onClick={toggleSelectionMode}
                className="font-text text-caption text-primary transition-transform duration-150 ease-out active:scale-95"
              >
                {selectionMode ? "Done selecting" : "Select"}
              </button>
            </div>

            {assetsExpanded && (
              <>
                <div className="mt-sm flex items-center justify-between gap-sm border-b border-hairline pb-sm">
                  <div className="flex items-center gap-xxs" aria-label="Sort uploads">
                    <span className="font-text text-fine-print text-ink-muted-48">Order:</span>
                    <button
                      type="button"
                      onClick={() => setSortOrder("date")}
                      className={`rounded-pill px-xs py-xxs font-text text-fine-print ${
                        sortOrder === "date" ? "bg-canvas-parchment text-ink" : "text-ink-muted-48"
                      }`}
                    >
                      Upload date
                    </button>
                    <button
                      type="button"
                      onClick={() => setSortOrder("name")}
                      className={`rounded-pill px-xs py-xxs font-text text-fine-print ${
                        sortOrder === "name" ? "bg-canvas-parchment text-ink" : "text-ink-muted-48"
                      }`}
                    >
                      Name
                    </button>
                  </div>
                  {selectionMode && selectedAssetIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setConfirmation({ kind: "assets", assetIds: selectedAssetIds })}
                      className="font-text text-caption text-red-500 transition-transform duration-150 ease-out active:scale-95"
                    >
                      Delete selected ({selectedAssetIds.length})
                    </button>
                  )}
                </div>

                {loading ? (
                  <p className="py-lg font-text text-caption text-ink-muted-48">Loading uploads…</p>
                ) : sortedAssets.length === 0 ? (
                  <p className="py-lg font-text text-caption text-ink-muted-48">No files have been uploaded yet.</p>
                ) : (
                  <ul className="divide-y divide-hairline">
                    {sortedAssets.map((asset) => (
                      <li key={asset.id} className="flex min-w-0 items-center gap-sm py-sm">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-text text-caption-strong text-ink">{asset.name}</p>
                          <p className="mt-xxs font-text text-fine-print text-ink-muted-48">
                            {formatAssetType(asset.type)} · {formatFileSize(asset.size)} · {new Date(asset.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        {selectionMode ? (
                          <input
                            type="checkbox"
                            aria-label={`Select ${asset.name}`}
                            checked={selectedAssetIds.includes(asset.id)}
                            onChange={() => toggleAssetSelection(asset.id)}
                            className="h-4 w-4 flex-shrink-0 accent-primary"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmation({ kind: "assets", assetIds: [asset.id] })}
                            className="flex-shrink-0 font-text text-caption text-red-500 transition-transform duration-150 ease-out active:scale-95"
                          >
                            Delete
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          {error && <p role="alert" className="mt-sm font-text text-caption text-red-500">{error}</p>}

          <div className="mt-lg border-t border-hairline pt-lg">
            <p className="font-text text-body-strong text-ink">Delete persona</p>
            <p className="mt-xs font-text text-caption text-ink-muted-80">
              {locale === "zh"
                ? `这将永久删除 ${persona.name}、其聊天记录和所有上传文件。`
                : `This permanently deletes ${persona.name}, its chat history, and all uploaded files.`}
            </p>
            <button
              type="button"
              onClick={requestPersonaDeletion}
              className="mt-sm font-text text-caption text-red-500 transition-transform duration-150 ease-out active:scale-95"
            >
              Delete persona
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={confirmation !== null} onClose={closeConfirmation} maxWidthClassName="max-w-[28rem]">
        {confirmation?.kind === "assets" ? (
          <>
            <h2 className="font-display text-tagline text-ink">Delete upload{confirmation.assetIds.length === 1 ? "" : "s"}?</h2>
            <p className="mt-xs font-text text-caption text-ink-muted-80">
              {confirmation.assetIds.length === 1 ? "This file" : `${confirmation.assetIds.length} files`} will be permanently deleted.
            </p>
            <div className="mt-lg flex justify-end gap-xs">
              <Button variant="secondary" onClick={closeConfirmation} disabled={deleting}>Cancel</Button>
              <button
                type="button"
                onClick={() => deleteAssets(confirmation.assetIds)}
                disabled={deleting}
                className="rounded-pill bg-red-500 px-[22px] py-[11px] font-text text-body text-white transition-transform duration-150 ease-out active:scale-95 disabled:pointer-events-none disabled:opacity-40"
              >
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </>
        ) : confirmation?.kind === "persona" ? (
          <>
            <h2 className="font-display text-tagline text-ink">Delete {persona.name}?</h2>
            <p className="mt-xs font-text text-caption text-ink-muted-80">
              This permanently deletes this persona, every upload, and its complete chat history. This cannot be undone.
            </p>
            <div className="mt-lg">
              <Input
                type="password"
                placeholder="Current password"
                value={personaPassword}
                onChange={(event) => setPersonaPassword(event.target.value)}
                autoComplete="current-password"
              />
              {confirmationError && (
                <p role="alert" className="mt-xs font-text text-caption text-red-500">{confirmationError}</p>
              )}
            </div>
            <div className="mt-lg flex justify-end gap-xs">
              <Button variant="secondary" onClick={closeConfirmation} disabled={deleting}>Cancel</Button>
              <button
                type="button"
                onClick={deletePersona}
                disabled={personaDeleteCountdown > 0 || deleting || !personaPassword}
                className="rounded-pill bg-red-500 px-[22px] py-[11px] font-text text-body text-white transition-transform duration-150 ease-out active:scale-95 disabled:pointer-events-none disabled:opacity-40"
              >
                {deleting ? "Deleting…" : personaDeleteCountdown > 0 ? `Delete in ${personaDeleteCountdown}s` : "Delete permanently"}
              </button>
            </div>
          </>
        ) : null}
      </Modal>
    </>
  );
}
