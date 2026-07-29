"use client";

import { ReactNode } from "react";
import { cn } from "@/shared/utils";

type UploadTileShellProps = {
  label: string;
  description: string;
  locked?: boolean;
  onLockedClick?: () => void;
  children: ReactNode;
};

const tileClass =
  "relative flex w-full flex-col gap-xs rounded-lg border border-hairline bg-canvas p-lg text-left";

export function UploadTileShell({
  label,
  description,
  locked,
  onLockedClick,
  children,
}: UploadTileShellProps) {
  const heading = (
    <>
      <p className="font-text text-body-strong text-ink">{label}</p>
      <p className="font-text text-caption text-ink-muted-48">{description}</p>
    </>
  );

  if (locked) {
    // A real <button>, not a div+onClick — otherwise this interaction is
    // mouse-only with no keyboard access (no tabIndex, no Enter/Space
    // handling). No interactive children render while locked, so a button
    // wrapper is valid here (unlike the unlocked case below, which holds
    // real form controls a <button> can't legally contain).
    return (
      <button
        type="button"
        onClick={onLockedClick}
        className={cn(tileClass, "cursor-pointer opacity-50 transition-transform duration-150 ease-out active:scale-[0.99]")}
      >
        <span className="absolute right-sm top-sm" aria-hidden>
          👑
        </span>
        {heading}
      </button>
    );
  }

  return (
    <div className={tileClass}>
      {heading}
      {children}
    </div>
  );
}
