"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Modal } from "@/front_end/components/ui";
import { useLocale } from "@/front_end/state/locale-context";
import type { DeleteAssetResponseBody } from "@/back_end/api/personas/[id]/assets/[assetId]/route";
import type { ListAssetsResponseBody, PersonaAssetDTO } from "@/back_end/api/personas/[id]/assets/route";
import { PERSONA_ASSET_SOURCES } from "@/shared/persona-asset-sources";

type SortOrder = "date" | "name";
type Confirmation = { assetIds: string[] } | null;

type PersonaAssetListProps = {
  personaId: string;
  refreshToken?: number;
  onChanged?: () => void;
};

function formatFileSize(size: number | null) {
  if (size === null) return "Unknown size";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatAssetType(asset: PersonaAssetDTO, locale: "en" | "zh") {
  if (asset.type === "video" && asset.source === PERSONA_ASSET_SOURCES.guidedFacialScan) {
    return locale === "zh" ? "说话录制" : "recording with talking";
  }
  if (asset.type === "video" && asset.source === PERSONA_ASSET_SOURCES.passiveFacialScan) {
    return locale === "zh" ? "自然动态面部扫描" : "passive facial scan";
  }
  if (asset.type === "audio" && asset.source === PERSONA_ASSET_SOURCES.guidedFacialScan) {
    return locale === "zh" ? "说话录制音频" : "recording with talking (audio)";
  }
  if (locale === "zh") {
    const labels: Record<PersonaAssetDTO["type"], string> = {
      image: "照片",
      video: "视频",
      audio: "音频",
      text: "文档",
      facial_scan: "面部扫描",
      social_link: "社交媒体链接",
    };
    return labels[asset.type];
  }
  return asset.type.replaceAll("_", " ");
}

function styleStatusLabel(state: string | undefined, locale: "en" | "zh") {
  const labels: Record<string, [string, string]> = {
    scripted: ["Scripted reading — excluded from spontaneous style", "照读稿件：不用于学习自然说话风格"],
    no_speech: ["No speech/audio — no wording evidence", "未检测到语音：没有语言风格依据"],
    ready: ["Verified original wording available", "已收录经确认的本人表达"],
    unverified: ["Speaker/author not yet confirmed", "说话者／作者尚未确认"],
    queued: ["Source processing queued", "已排队处理语料"],
    running: ["Transcribing/indexing source…", "正在转写并整理语料…"],
    failed: ["Source processing failed — retry confirmation", "语料处理失败：请重新确认以重试"],
  };
  const pair = state ? labels[state] : undefined;
  return pair ? pair[locale === "zh" ? 1 : 0] : null;
}

// Used by both the initial upload wizard and later persona management, so the
// owner sees the same sortable/selectable list and irreversible-delete flow
// at either point in the persona lifecycle.
export function PersonaAssetList({ personaId, refreshToken = 0, onChanged }: PersonaAssetListProps) {
  const { locale } = useLocale();
  const [assets, setAssets] = useState<PersonaAssetDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assetsExpanded, setAssetsExpanded] = useState(true);
  const [sortOrder, setSortOrder] = useState<SortOrder>("date");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [deleting, setDeleting] = useState(false);
  const [styleSaving, setStyleSaving] = useState<string | null>(null);
  const [styleNotice, setStyleNotice] = useState<string | null>(null);

  async function setStyleSource(asset: PersonaAssetDTO, confirmed: boolean) {
    setStyleSaving(asset.id);
    setStyleNotice(null);
    setError(null);
    try {
      const response = await fetch(`/api/personas/${personaId}/assets/${asset.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetAuthorship: confirmed ? "target" : "unknown" }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Couldn't save wording evidence.");
      setAssets(current => current.map(item => item.id === asset.id ? { ...item,
        targetAuthorship: confirmed ? "target" : "unknown",
        styleEvidenceStatus: ["scripted", "no_speech"].includes(item.styleEvidenceStatus || "")
          ? item.styleEvidenceStatus : confirmed ? "queued" : "unverified",
      } : item));
      setStyleNotice(locale === "zh" ? "已保存。语音/文字处理将在后台继续；照读的稿件不会用于学习自然说话风格。" : "Saved. Source processing continues in the background; scripted readings are excluded from spontaneous style.");
    } catch (error) {
      setError(error instanceof Error ? error.message : (locale === "zh" ? "保存失败，请重试。" : "Couldn't save. Please retry."));
    } finally { setStyleSaving(null); }
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/personas/${personaId}/assets`, { cache: "no-store" })
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
  }, [personaId, refreshToken]);

  const sortedAssets = useMemo(() => [...assets].sort((first, second) => {
    if (sortOrder === "name") return first.name.localeCompare(second.name);
    return new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime();
  }), [assets, sortOrder]);

  function toggleSelectionMode() {
    setSelectionMode((active) => !active);
    setSelectedAssetIds([]);
  }

  function toggleAssetSelection(assetId: string) {
    setSelectedAssetIds((selected) => (
      selected.includes(assetId) ? selected.filter((id) => id !== assetId) : [...selected, assetId]
    ));
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
      onChanged?.();
    } catch {
      setError("Couldn't delete the selected upload. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="mt-lg rounded-lg border border-hairline bg-canvas p-lg">
        <div className="flex items-center justify-between gap-sm">
          <button
            type="button"
            onClick={() => setAssetsExpanded((expanded) => !expanded)}
            aria-expanded={assetsExpanded}
            className="flex min-w-0 items-center gap-xs text-left"
          >
            <span className="font-text text-body-strong text-ink">
              {locale === "zh" ? `上传内容（${assets.length}）` : `Uploads (${assets.length})`}
            </span>
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
            {locale === "zh" ? (selectionMode ? "完成选择" : "选择") : (selectionMode ? "Done selecting" : "Select")}
          </button>
        </div>

        {assetsExpanded && (
          <>
            <p className="mt-sm font-text text-fine-print text-ink-muted-48">
              {locale === "zh" ? "只将本人说或写的内容标记为风格依据；多人对话、引文和照读稿件不应视为自然表达。" : "Confirm only this person’s own speech or writing as wording evidence—not mixed speakers, quotations or scripted readings."}
            </p>
            <div className="mt-sm flex items-center justify-between gap-sm border-b border-hairline pb-sm">
              <div className="flex items-center gap-xxs" aria-label="Sort uploads">
                <span className="font-text text-fine-print text-ink-muted-48">{locale === "zh" ? "排序：" : "Order:"}</span>
                <button type="button" onClick={() => setSortOrder("date")} className={`rounded-pill px-xs py-xxs font-text text-fine-print ${sortOrder === "date" ? "bg-canvas-parchment text-ink" : "text-ink-muted-48"}`}>
                  {locale === "zh" ? "上传日期" : "Upload date"}
                </button>
                <button type="button" onClick={() => setSortOrder("name")} className={`rounded-pill px-xs py-xxs font-text text-fine-print ${sortOrder === "name" ? "bg-canvas-parchment text-ink" : "text-ink-muted-48"}`}>
                  {locale === "zh" ? "名称" : "Name"}
                </button>
              </div>
              {selectionMode && selectedAssetIds.length > 0 && (
                <button type="button" onClick={() => setConfirmation({ assetIds: selectedAssetIds })} className="font-text text-caption text-red-500 transition-transform duration-150 ease-out active:scale-95">
                  {locale === "zh" ? `删除所选内容（${selectedAssetIds.length}）` : `Delete selected (${selectedAssetIds.length})`}
                </button>
              )}
            </div>

            {loading ? (
              <p className="py-lg font-text text-caption text-ink-muted-48">{locale === "zh" ? "正在加载上传内容…" : "Loading uploads…"}</p>
            ) : sortedAssets.length === 0 ? (
              <p className="py-lg font-text text-caption text-ink-muted-48">{locale === "zh" ? "尚未上传任何文件。" : "No files have been uploaded yet."}</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {sortedAssets.map((asset) => (
                  <li key={asset.id} className="flex min-w-0 items-center gap-sm py-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-text text-caption-strong text-ink">{asset.name}</p>
                      <p className="mt-xxs font-text text-fine-print text-ink-muted-48">
                        {formatAssetType(asset, locale)} · {formatFileSize(asset.size)} · {new Date(asset.createdAt).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US")}
                      </p>
                      {["audio", "video", "text", "image"].includes(asset.type) && (
                        <label className="mt-xs flex items-start gap-xs font-text text-fine-print text-ink-muted-80">
                          <input type="checkbox" className="mt-[2px] h-4 w-4 shrink-0 accent-primary"
                            checked={asset.targetAuthorship === "target"} disabled={styleSaving !== null}
                            onChange={event => setStyleSource(asset, event.target.checked)} />
                          <span>{locale === "zh" ? "确认：此文件中的语言表达出自本人" : "Confirmed: this file’s wording is this person’s own"}
                            {styleSaving === asset.id && (locale === "zh" ? " · 保存中…" : " · Saving…")}</span>
                        </label>
                      )}
                      {styleStatusLabel(asset.styleEvidenceStatus, locale) && (
                        <p className="mt-xxs font-text text-fine-print text-ink-muted-48">{styleStatusLabel(asset.styleEvidenceStatus, locale)}</p>
                      )}
                    </div>
                    {selectionMode ? (
                      <input type="checkbox" aria-label={`Select ${asset.name}`} checked={selectedAssetIds.includes(asset.id)} onChange={() => toggleAssetSelection(asset.id)} className="h-4 w-4 flex-shrink-0 accent-primary" />
                    ) : (
                      <button type="button" onClick={() => setConfirmation({ assetIds: [asset.id] })} className="flex-shrink-0 font-text text-caption text-red-500 transition-transform duration-150 ease-out active:scale-95">
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
      {styleNotice && <p role="status" className="mt-sm font-text text-caption text-ink-muted-80">{styleNotice}</p>}

      <Modal open={confirmation !== null} onClose={() => setConfirmation(null)} maxWidthClassName="max-w-[28rem]">
        {confirmation && (
          <>
            <h2 className="font-display text-tagline text-ink">Delete upload{confirmation.assetIds.length === 1 ? "" : "s"}?</h2>
            <p className="mt-xs font-text text-caption text-ink-muted-80">
              {confirmation.assetIds.length === 1 ? "This file" : `${confirmation.assetIds.length} files`} will be permanently deleted.
            </p>
            <div className="mt-lg flex justify-end gap-xs">
              <Button variant="secondary" onClick={() => setConfirmation(null)} disabled={deleting}>Cancel</Button>
              <button type="button" onClick={() => deleteAssets(confirmation.assetIds)} disabled={deleting} className="rounded-pill bg-red-500 px-[22px] py-[11px] font-text text-body text-white transition-transform duration-150 ease-out active:scale-95 disabled:pointer-events-none disabled:opacity-40">
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
