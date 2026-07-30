"use client";

import { HTMLAttributes, useSyncExternalStore } from "react";
import { cn } from "@/shared/utils";

export type DockProps = HTMLAttributes<HTMLDivElement>;

function subscribeToScroll(callback: () => void) {
  window.addEventListener("scroll", callback, { passive: true });
  return () => window.removeEventListener("scroll", callback);
}

// Scroll position lives outside React; useSyncExternalStore reads it without
// a setState-in-effect render cascade, and getServerSnapshot keeps SSR/first
// paint matching the "not scrolled" state so there's no hydration mismatch.
function useIsScrolled(threshold = 8) {
  return useSyncExternalStore(
    subscribeToScroll,
    () => window.scrollY > threshold,
    () => false,
  );
}

// Floating liquid-glass navigation surface. The layered CSS treatment gives
// the dock a refractive highlight and a soft inner rim rather than the older
// uniform frosted panel effect, while preserving contrast over every page.
export function Dock({ className, children, ...props }: DockProps) {
  const scrolled = useIsScrolled();

  return (
    <div
      className={cn(
        "liquid-glass-dock rounded-pill transition-[background-color,border-color,box-shadow,backdrop-filter,transform] duration-300 ease-out",
        scrolled && "liquid-glass-dock-scrolled",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
