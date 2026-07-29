"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Modal } from "@/front_end/components/ui";
import { useLocale } from "@/front_end/state/locale-context";
import type { DeleteAssetResponseBody } from "@/back_end/api/personas/[id]/assets/[assetId]/route";
import type { ListAssetsResponseBody, PersonaAssetDTO } from "@/back_end/api/personas/[id]/assets/route";

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

function formatAssetType(type: PersonaAssetDTO["type"], locale: "en" | "zh") {
  if (locale === "zh") {
    const labels: Record<PersonaAssetDTO["type"], string> = {
      image: "照片",
      video: "视频",
      audio: "音频",
      text: "文档",
      facial_scan: "面部扫描",
      social_link: "社交媒体链接",
    };
    return labels[type];
  }
  return type.replaceAll("_", " ");
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
                        {formatAssetType(asset.type, locale)} · {formatFileSize(asset.size)} · {new Date(asset.createdAt).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US")}
                      </p>
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
