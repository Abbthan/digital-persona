"use client";

import { useEffect, useState } from "react";
import { cn } from "@/shared/utils";

type UserAvatarProps = {
  username: string;
  /** The user's current profile image storage path (User.profileImageUrl),
   * not the displayable URL — used only to key the fetch below. */
  profileImageUrl: string | null;
  className?: string;
};

// Signed URLs expire, so this fetches a fresh one on mount rather than
// storing a permanent src — consistent with lib/storage.ts's approach to
// never persisting a public link for personal media. Keyed on the actual
// profileImageUrl path (which changes to a fresh UUID on every upload)
// rather than a boolean "has one or not" — a boolean stays `true` across a
// re-upload, so the effect never re-ran and the old signed URL kept showing
// until a full page reload remounted this component from scratch.
export function UserAvatar({ username, profileImageUrl, className }: UserAvatarProps) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!profileImageUrl) return;
    let cancelled = false;
    async function loadAvatar() {
      try {
        const response = await fetch("/api/account/avatar", {
          cache: "no-store",
          credentials: "same-origin",
        });
        const contentType = response.headers.get("content-type") ?? "";
        if (!response.ok || !contentType.includes("application/json")) return;
        const data = await response.json().catch(() => null) as { url?: unknown } | null;
        if (!cancelled && data && (typeof data.url === "string" || data.url === null)) {
          setUrl(data.url);
        }
      } catch {
        // A stale cached account can mount briefly while /api/auth/me clears
        // an expired session. Keep the initials fallback without emitting an
        // unhandled promise rejection if that avatar request is interrupted.
      }
    }
    void loadAvatar();
    return () => {
      cancelled = true;
    };
  }, [profileImageUrl]);

  // Derived rather than reset via a synchronous setState in the effect above
  // (flagged by react-hooks/set-state-in-effect) — if profileImageUrl goes
  // away, this just stops treating a stale fetched url as current.
  const displayUrl = profileImageUrl ? url : null;

  if (displayUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not worth Next/Image's remote-pattern config
      <img
        src={displayUrl}
        alt=""
        className={cn("flex-shrink-0 rounded-full object-cover", className)}
      />
    );
  }

  return (
    <span
      className={cn(
        "flex flex-shrink-0 items-center justify-center rounded-full bg-primary font-text text-caption-strong text-on-primary",
        className,
      )}
    >
      {username.charAt(0).toUpperCase()}
    </span>
  );
}
