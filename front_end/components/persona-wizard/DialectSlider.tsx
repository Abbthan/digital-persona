"use client";

import { useEffect, useRef, useState } from "react";
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import { useLocale } from "@/front_end/state/locale-context";

const DIALECT_OPTIONS = ["mandarin", "wu"] as const;
export type SttDialectPreference = (typeof DIALECT_OPTIONS)[number];

const TRACK_PADDING = 3;
const SPRING = { stiffness: 500, damping: 32 };

// Same Apple-style momentum-segmented pattern as NameModal's PersonaStyleSlider
// (Realistic/Cartoon) — drag with rubber-banding, spring-snaps to the nearest
// segment on release.
export function DialectSlider({
  value,
  onChange,
}: {
  value: SttDialectPreference;
  onChange: (value: SttDialectPreference) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [segmentWidth, setSegmentWidth] = useState(0);
  const x = useMotionValue(0);
  const reduceMotion = useReducedMotion();
  const { locale } = useLocale();
  const activeIndex = DIALECT_OPTIONS.indexOf(value);

  useEffect(() => {
    const measure = () => {
      if (trackRef.current) setSegmentWidth((trackRef.current.offsetWidth - TRACK_PADDING * 2) / DIALECT_OPTIONS.length);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    if (!segmentWidth) return;
    const controls = animate(x, activeIndex * segmentWidth, {
      type: reduceMotion ? "tween" : "spring",
      duration: reduceMotion ? 0 : undefined,
      ...SPRING,
    });
    return () => controls.stop();
  }, [activeIndex, reduceMotion, segmentWidth, x]);

  function snapTo(index: number) {
    const nextIndex = Math.max(0, Math.min(DIALECT_OPTIONS.length - 1, index));
    if (nextIndex === activeIndex || !segmentWidth) {
      if (segmentWidth) {
        animate(x, activeIndex * segmentWidth, { type: reduceMotion ? "tween" : "spring", duration: reduceMotion ? 0 : undefined, ...SPRING });
      }
      return;
    }
    onChange(DIALECT_OPTIONS[nextIndex]);
  }

  return (
    <div ref={trackRef} className="relative mt-sm flex w-full select-none overflow-hidden rounded-pill bg-canvas p-[3px]">
      {segmentWidth > 0 && (
        <motion.div
          drag="x"
          dragConstraints={{ left: 0, right: segmentWidth }}
          dragElastic={0}
          dragMomentum={false}
          onDragEnd={() => snapTo(Math.round(x.get() / segmentWidth))}
          style={{ x, width: segmentWidth }}
          className="absolute top-[3px] bottom-[3px] left-[3px] cursor-grab touch-none rounded-pill bg-surface-chip-translucent shadow-dock active:cursor-grabbing"
        />
      )}
      {DIALECT_OPTIONS.map((dialect, index) => (
        <button
          key={dialect}
          type="button"
          aria-pressed={value === dialect}
          onClick={() => snapTo(index)}
          className={`relative z-10 flex-1 py-xs text-center font-text text-caption-strong transition-colors duration-150 ${value === dialect ? "pointer-events-none text-ink" : "text-ink-muted-48"}`}
        >
          {dialect === "mandarin"
            ? (locale === "zh" ? "普通话" : "Mandarin")
            : (locale === "zh" ? "吴语" : "Wu Dialect")}
        </button>
      ))}
    </div>
  );
}
