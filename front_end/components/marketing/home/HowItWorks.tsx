"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { Parallax } from "@/front_end/components/marketing/Parallax";
import { PlaceholderArt } from "@/front_end/components/marketing/PlaceholderArt";
import { Section } from "@/front_end/components/marketing/Section";

const steps = [
  {
    number: "01",
    title: "Upload their media",
    body: "Photos, videos, audio, chat exports, and social links — as much or as little as you have.",
  },
  {
    number: "02",
    title: "We learn who they are",
    body: "ECHO studies their voice, face, and personality from what you upload.",
  },
  {
    number: "03",
    title: "Talk to their persona",
    body: "Chat by text, or step into a live voice and video conversation.",
  },
];

export function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  // Cross-fades in as this section's top edge travels from just below the
  // viewport ("start end") to fully covering it ("start start"). Paired with
  // Hero's position:sticky (Hero.tsx), that's what turns the reveal into a
  // soft dissolve over the pinned hero instead of a hard-edged cut — and
  // only this, the immediate next section, does it; sections further down
  // scroll in normally. Only the fill (background prop below) animates —
  // Section's own tone="dark" background is cancelled via !bg-transparent so
  // it doesn't just sit there opaque behind it — the text/cards stay at full
  // opacity throughout, never fading with the black.
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "start start"] });
  const backgroundOpacity = useTransform(scrollYProgress, [0, 1], [0, 1]);

  return (
    <div ref={ref}>
      <Section
        tone="dark"
        className="!bg-transparent"
        background={
          <motion.div
            className="absolute inset-0 bg-surface-tile-1"
            style={reduceMotion ? undefined : { opacity: backgroundOpacity }}
            aria-hidden="true"
          />
        }
      >
        <p className="font-text text-caption-strong text-body-muted">How it works</p>
        <h2 className="mt-xs font-display text-display-lg text-on-dark">
          From memories to a conversation
        </h2>

        <div className="mt-xxl grid w-full grid-cols-1 gap-xl text-left sm:grid-cols-3">
          {steps.map((step, index) => (
            <Parallax key={step.number} speed={index % 2 === 0 ? 0.1 : -0.1} className="flex flex-col gap-sm">
              <PlaceholderArt variant="dark" />
              <p className="font-text text-caption-strong text-primary-on-dark">{step.number}</p>
              <p className="font-text text-body-strong text-on-dark">{step.title}</p>
              <p className="font-text text-body text-body-muted">{step.body}</p>
            </Parallax>
          ))}
        </div>
      </Section>
    </div>
  );
}
