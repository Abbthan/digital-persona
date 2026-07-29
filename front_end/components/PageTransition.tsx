"use client";

import { motion, useReducedMotion } from "motion/react";
import { usePathname } from "next/navigation";
import { ReactNode, useLayoutEffect } from "react";

type PageTransitionProps = {
  children: ReactNode;
};

// No AnimatePresence/exit here on purpose — the outgoing page unmounts
// immediately (no fade-out), and only the incoming page animates: a fade
// paired with a gentle scale-up + upward settle, the "content rises into
// place" entrance common on Apple's own pages. motion.div plays its
// initial->animate transition on mount regardless of AnimatePresence, which
// is only needed to delay unmount for an exit animation — removing it here
// also sidesteps any coordination between an exiting and entering instance.
export function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();

  // Next normally scrolls on link navigation, but explicitly resetting here
  // also covers programmatic route changes and keeps every incoming page in
  // sync with the no-scroll-restoration rule set before first paint.
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    const frame = window.requestAnimationFrame(() => window.scrollTo(0, 0));
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, scale: 0.97, y: 14 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.5, ease: "easeOut" }}
      className="flex flex-1 flex-col"
    >
      {children}
    </motion.div>
  );
}
