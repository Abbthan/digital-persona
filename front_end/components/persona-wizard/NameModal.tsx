"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import { Button, Input, Modal } from "@/front_end/components/ui";
import type { CreatePersonaResponseBody } from "@/back_end/api/personas/route";

type NameModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (persona: { id: string; name: string }) => void;
};

const STYLE_OPTIONS = ["realistic", "cartoon"] as const;
const TRACK_PADDING = 3;
const SPRING = { stiffness: 500, damping: 32 };

function PersonaStyleSlider({
  value,
  onChange,
  onCartoonBlocked,
}: {
  value: "realistic" | "cartoon";
  onChange: (value: "realistic" | "cartoon") => void;
  onCartoonBlocked: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [segmentWidth, setSegmentWidth] = useState(0);
  const x = useMotionValue(0);
  const reduceMotion = useReducedMotion();
  const activeIndex = STYLE_OPTIONS.indexOf(value);

  useEffect(() => {
    const measure = () => {
      if (trackRef.current) setSegmentWidth((trackRef.current.offsetWidth - TRACK_PADDING * 2) / STYLE_OPTIONS.length);
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
    const nextIndex = Math.max(0, Math.min(STYLE_OPTIONS.length - 1, index));
    const snapBack = () => {
      if (segmentWidth) animate(x, activeIndex * segmentWidth, { type: reduceMotion ? "tween" : "spring", duration: reduceMotion ? 0 : undefined, ...SPRING });
    };
    if (nextIndex === activeIndex || !segmentWidth) {
      snapBack();
      return;
    }
    // Cartoon has no model behind it yet — only Realistic (MuseTalk) is
    // wired up. Say so and leave the choice on Realistic rather than
    // silently accepting a style nothing downstream can honor.
    if (STYLE_OPTIONS[nextIndex] === "cartoon") {
      snapBack();
      onCartoonBlocked();
      return;
    }
    onChange(STYLE_OPTIONS[nextIndex]);
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
      {STYLE_OPTIONS.map((style, index) => (
        <button
          key={style}
          type="button"
          aria-pressed={value === style}
          onClick={() => snapTo(index)}
          className={`relative z-10 flex-1 py-xs text-center font-text text-caption-strong transition-colors duration-150 ${value === style ? "pointer-events-none text-ink" : "text-ink-muted-48"}`}
        >
          {style === "realistic" ? "Realistic" : "Cartoon"}
        </button>
      ))}
    </div>
  );
}

export function NameModal({ open, onClose, onCreated }: NameModalProps) {
  const [name, setName] = useState("");
  const [avatarStyle, setAvatarStyle] = useState<"realistic" | "cartoon">("realistic");
  const [cartoonBlocked, setCartoonBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/personas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, avatarStyle }),
      });
      const result = (await response.json()) as CreatePersonaResponseBody;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setName("");
      onCreated(result.persona);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <h2 className="font-display text-tagline text-ink">Name your persona</h2>
      <form onSubmit={handleSubmit} className="mt-lg flex flex-col gap-sm">
        <Input
          placeholder="e.g. Grandma Rose"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          autoFocus
        />
        <div className="rounded-md border border-hairline bg-canvas-parchment p-sm">
          <p className="font-text text-caption-strong text-ink">Persona appearance</p>
          <p className="mt-xxs font-text text-fine-print text-ink-muted-48">Choose the future live-video style. This cannot be changed after the persona is created.</p>
          <PersonaStyleSlider
            value={avatarStyle}
            onChange={(next) => {
              setCartoonBlocked(false);
              setAvatarStyle(next);
            }}
            onCartoonBlocked={() => setCartoonBlocked(true)}
          />
          {cartoonBlocked && (
            <p role="alert" className="mt-xs font-text text-caption text-red-500">
              Cartoon style isn&apos;t available yet — only Realistic is supported right now.
            </p>
          )}
        </div>
        {error && <p className="font-text text-caption text-red-500">{error}</p>}
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? "Creating…" : "Continue"}
        </Button>
      </form>
    </Modal>
  );
}
