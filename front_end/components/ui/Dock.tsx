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

// Floating pill/rounded-rect surface — not documented in DESIGN.md (Apple's
// analyzed marketing pages use a full-width global-nav, not a floating one).
// Composed from the closest documented patterns instead: the backdrop-blur
// treatment of sub-nav-frosted / floating-sticky-bar for the scrolled state,
// the pill grammar, and (per Phase 1's explicit ask) a solid top state with
// shadow-dock — see the note on that token in app/globals.css.
export function Dock({ className, children, ...props }: DockProps) {
  const scrolled = useIsScrolled();

  return (
    <div
      className={cn(
        "rounded-pill border transition-[background-color,border-color,box-shadow,backdrop-filter] duration-300 ease-out",
        scrolled
          ? "border-hairline/60 bg-canvas-parchment/55 shadow-none backdrop-blur-[20px] backdrop-saturate-[180%]"
          : "border-transparent bg-canvas shadow-dock backdrop-blur-none",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
