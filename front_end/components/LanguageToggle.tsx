"use client";

import { motion, useReducedMotion } from "motion/react";
import { useLocale } from "@/front_end/state/locale-context";
import { cn } from "@/shared/utils";

export function LanguageToggle({ className }: { className?: string }) {
  const { locale, toggleLocale } = useLocale();
  const reduceMotion = useReducedMotion();
  const englishSelected = locale === "en";

  return (
    <motion.button
      type="button"
      onClick={toggleLocale}
      aria-label={englishSelected ? "Switch language to Chinese" : "Switch language to English"}
      title={englishSelected ? "切换至中文" : "Switch to English"}
      // Server rendering always assumes "en" (see locale-context.tsx); the
      // real locale is applied a moment later from a layout effect, before
      // paint. That expected one-time mismatch would otherwise log a
      // hydration warning here even though it's corrected immediately.
      suppressHydrationWarning
      whileTap={reduceMotion ? undefined : { scale: 0.86 }}
      animate={{ scale: 1 }}
      transition={{ type: "spring", stiffness: 460, damping: 21, mass: 0.45 }}
      className={cn(
        "relative flex h-9 w-11 items-center justify-center overflow-hidden rounded-pill bg-transparent transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus",
        className,
      )}
    >
      <span
        aria-hidden="true"
        suppressHydrationWarning
        className={cn(
          "pointer-events-none absolute left-[7px] top-[4px] text-[16px] leading-none transition-all duration-200",
          englishSelected ? "opacity-100 grayscale-0" : "opacity-35 grayscale",
        )}
      >
        🇬🇧
      </span>
      <span
        aria-hidden="true"
        suppressHydrationWarning
        className={cn(
          "pointer-events-none absolute bottom-[4px] right-[6px] text-[16px] leading-none transition-all duration-200",
          englishSelected ? "opacity-35 grayscale" : "opacity-100 grayscale-0",
        )}
      >
        🇨🇳
      </span>
    </motion.button>
  );
}
