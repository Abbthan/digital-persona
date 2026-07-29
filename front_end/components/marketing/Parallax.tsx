"use client";

import { ReactNode, useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";

type ParallaxProps = {
  /** -1..1 — negative drifts up relative to scroll, positive drifts down. */
  speed?: number;
  className?: string;
  children: ReactNode;
};

// Scroll-linked layer for Home/About marketing sections. Fully disabled
// (renders static, no transform at all) under prefers-reduced-motion, per
// Phase 2's explicit requirement — not just slowed down.
export function Parallax({ speed = 0.2, className, children }: ParallaxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], [`${speed * -100}px`, `${speed * 100}px`]);

  return (
    <motion.div ref={ref} style={reduceMotion ? undefined : { y }} className={className}>
      {children}
    </motion.div>
  );
}
