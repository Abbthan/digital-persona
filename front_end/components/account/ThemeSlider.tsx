"use client";

import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme, type ThemePreference } from "@/front_end/state/theme-context";
import { cn } from "@/shared/utils";

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

const TRACK_PADDING = 3;
const SPRING = { stiffness: 500, damping: 32 };

// Nearest whole segment to a continuous (unrounded) index. A landing exactly
// on the midpoint between two segments is a genuine tie — instead of always
// rounding the same direction, it breaks toward whichever side isn't where
// the drag started, so it always reads as "kept going" rather than snapping
// backward.
function nearestIndex(rawIndex: number, startIndex: number, maxIndex: number): number {
  const clamped = Math.min(maxIndex, Math.max(0, rawIndex));
  const lower = Math.floor(clamped);
  const upper = Math.ceil(clamped);
  if (lower === upper) return lower;
  const fraction = clamped - lower;
  if (fraction === 0.5) return startIndex <= lower ? upper : lower;
  return fraction < 0.5 ? lower : upper;
}

// Apple-style 3-way segmented toggle: a pill that slides under whichever
// label is active, draggable (with edge rubber-banding) and spring-snapping
// to the nearest segment on release, matching macOS's Appearance control.
export function ThemeSlider() {
  const { preference, setPreference } = useTheme();
  const trackRef = useRef<HTMLDivElement>(null);
  const [segmentWidth, setSegmentWidth] = useState(0);
  const x = useMotionValue(0);
  const reduceMotion = useReducedMotion();
  const activeIndex = OPTIONS.findIndex((option) => option.value === preference);
  const dragStartIndexRef = useRef(activeIndex);

  useEffect(() => {
    function measure() {
      if (trackRef.current) {
        setSegmentWidth((trackRef.current.offsetWidth - TRACK_PADDING * 2) / OPTIONS.length);
      }
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Drives the thumb whenever the logical selection changes (click, or a
  // drag that landed on a different segment than it started).
  useEffect(() => {
    if (!segmentWidth || activeIndex < 0) return;
    const controls = animate(x, activeIndex * segmentWidth, {
      type: reduceMotion ? "tween" : "spring",
      duration: reduceMotion ? 0 : undefined,
      ...SPRING,
    });
    return () => controls.stop();
  }, [activeIndex, segmentWidth, x, reduceMotion]);

  const snapTo = useCallback(
    (index: number) => {
      if (segmentWidth <= 0) return;
      if (index === activeIndex) {
        // Same option as before, so the effect above won't re-fire (React
        // bails on an identical setPreference value) — animate directly so
        // a slow/undershot drag still snaps the thumb back into place
        // instead of being left stranded wherever the pointer let go.
        animate(x, index * segmentWidth, {
          type: reduceMotion ? "tween" : "spring",
          duration: reduceMotion ? 0 : undefined,
          ...SPRING,
        });
      } else {
        setPreference(OPTIONS[index].value);
      }
    },
    [segmentWidth, activeIndex, x, reduceMotion, setPreference],
  );

  function handleDragEnd() {
    if (segmentWidth <= 0) return;
    // x is the thumb's own track-relative position — using it (rather than
    // the drag pointer's raw page position) is what makes this correct
    // regardless of where within the thumb the gesture originally grabbed.
    snapTo(nearestIndex(x.get() / segmentWidth, dragStartIndexRef.current, OPTIONS.length - 1));
  }

  return (
    <div
      ref={trackRef}
      className="relative flex w-full select-none overflow-hidden rounded-pill bg-canvas-parchment p-[3px]"
    >
      {segmentWidth > 0 && (
        <motion.div
          drag="x"
          dragConstraints={{ left: 0, right: segmentWidth * (OPTIONS.length - 1) }}
          dragElastic={0}
          dragMomentum={false}
          onDragStart={() => {
            dragStartIndexRef.current = Math.round(x.get() / segmentWidth);
          }}
          onDragEnd={handleDragEnd}
          style={{ x, width: segmentWidth }}
          className="absolute top-[3px] bottom-[3px] left-[3px] cursor-grab touch-none rounded-pill bg-canvas shadow-dock active:cursor-grabbing"
        />
      )}
      {OPTIONS.map((option, index) => (
        <button
          type="button"
          key={option.value}
          aria-pressed={preference === option.value}
          onClick={() => snapTo(index)}
          className={cn(
            "relative z-10 flex-1 py-xs text-center font-text text-caption-strong transition-colors duration-150",
            preference === option.value ? "pointer-events-none text-ink" : "text-ink-muted-48",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
