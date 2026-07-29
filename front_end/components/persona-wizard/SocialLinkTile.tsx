"use client";

import { FormEvent, useState } from "react";
import { Button, Input } from "@/front_end/components/ui";
import { useLocale } from "@/front_end/state/locale-context";
import { UploadTileShell } from "./UploadTileShell";

type SocialLinkTileProps = {
  personaId: string;
  onAdded?: () => void;
};

export function SocialLinkTile({ personaId, onAdded }: SocialLinkTileProps) {
  const { locale } = useLocale();
  const [url, setUrl] = useState("");
  const [links, setLinks] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch(`/api/personas/${personaId}/import-social`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const result = await response.json();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setLinks((current) => [...current, result.asset.name]);
      setUrl("");
      onAdded?.();
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <UploadTileShell
      label={locale === "zh" ? "社交媒体链接" : "Social media links"}
      description={locale === "zh" ? "公开的 Instagram、Facebook、X、YouTube 或小红书主页" : "Public Instagram, Facebook, X, YouTube, or Xiaohongshu profile"}
    >
      <form onSubmit={handleSubmit} className="flex gap-xs">
        <Input
          placeholder="https://instagram.com/account"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          className="flex-1"
        />
        <Button type="submit" variant="secondary" disabled={submitting}>
          {locale === "zh" ? "添加" : "Add"}
        </Button>
      </form>
      <p className="font-text text-fine-print text-ink-muted-48">
        {locale === "zh"
          ? "会将主页中公开可见的信息（名称、简介）作为文件保存，与其他上传内容放在一起；不会读取账户的帖子或照片。"
          : "Saves a note of what&apos;s publicly visible on the profile page (name, bio) as a file alongside your other uploads — not the account's posts or photos."}
      </p>
      {error && <p className="font-text text-caption text-red-500">{error}</p>}
      {links.length > 0 && (
        <ul className="flex flex-col gap-xxs">
          {links.map((link) => (
            <li key={link} className="truncate font-text text-caption text-ink-muted-80">
              {link}
            </li>
          ))}
        </ul>
      )}
    </UploadTileShell>
  );
}
