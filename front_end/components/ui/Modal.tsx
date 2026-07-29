"use client";

import { HTMLAttributes, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/shared/utils";

// motion.div redefines onDrag/onDragStart/onDragEnd/onAnimationStart/onAnimationEnd
// with its own (gesture-aware) signatures — omit the plain-DOM versions of
// those from HTMLAttributes so passing {...props} through to motion.div
// below doesn't collide. No Modal consumer uses these.
export type ModalProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart" | "onAnimationEnd"
> & {
  open: boolean;
  onClose: () => void;
  /** Tailwind max-w-* class for the panel. Kept separate from `className` so
   * it can't collide with the default — cn() doesn't dedupe conflicting
   * utilities, so two max-w-* classes on one element would both ship. */
  maxWidthClassName?: string;
};

const emptySubscribe = () => () => {};

// Portals need `document.body`, which doesn't exist during SSR. This reads
// as "are we on the client" without setState-in-effect (flagged by the
// react-hooks lint rule) or a hydration mismatch.
function useIsClient() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

// Nested modals (e.g. the pricing modal opened from a locked tile inside the
// upload wizard, or the checkout modal inside the pricing modal) each mount
// their own Modal instance. Without tracking which one is topmost, a single
// Escape keypress fires every open modal's onClose at once — observed in
// testing as the upload wizard finishing/closing early when dismissing a
// pricing modal stacked on top of it. Only the topmost open modal responds
// to Escape/Tab.
let modalStack: symbol[] = [];
const stackListeners = new Set<() => void>();

function notifyStackListeners() {
  stackListeners.forEach((listener) => listener());
}

function useIsTopmostModal(open: boolean): boolean {
  const [id] = useState(() => Symbol("modal"));
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const listener = () => forceUpdate((count) => count + 1);
    stackListeners.add(listener);
    return () => {
      stackListeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    modalStack = [...modalStack, id];
    notifyStackListeners();
    return () => {
      modalStack = modalStack.filter((entry) => entry !== id);
      notifyStackListeners();
    };
  }, [open, id]);

  return open && modalStack[modalStack.length - 1] === id;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// DESIGN.md doesn't document a modal (not present on the analyzed marketing
// pages), so this follows the system's general rules instead: flat canvas
// surface, hairline border, no shadow (the source system reserves its one
// shadow for product imagery, never chrome) — separation from the page comes
// from a dark scrim behind the panel instead.
export function Modal({
  open,
  onClose,
  maxWidthClassName = "max-w-[28rem]",
  className,
  children,
  ...props
}: ModalProps) {
  const isClient = useIsClient();
  const isTopmost = useIsTopmostModal(open);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;

    triggerRef.current = document.activeElement;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusable?.[0] ?? panelRef.current)?.focus();

    return () => {
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || !isTopmost) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusableEls = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusableEls.length === 0) return;

      const first = focusableEls[0];
      const last = focusableEls[focusableEls.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, isTopmost, onClose]);

  if (!isClient) return null;

  // Accelerate-then-decelerate (easeInOut) on the way in and out, rather than
  // an instant show/hide — AnimatePresence keeps the exit animation playing
  // for the duration below before actually unmounting.
  const transition = { duration: reduceMotion ? 0 : 0.28, ease: "easeInOut" as const };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-surface-black/40 p-lg backdrop-blur-sm"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transition}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
            initial={{ opacity: 0, scale: 0.94, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 4 }}
            transition={transition}
            className={cn(
              // Frosted glass: translucent + blurred + a saturation boost so
              // whatever's behind the panel (the blurred scrim + page) shows
              // through softly, Apple sheet/vibrancy-material style, rather
              // than the previous flat opaque canvas fill.
              "relative w-full rounded-lg border border-hairline/60 bg-canvas/75 p-xl font-text text-body text-ink shadow-dock outline-none backdrop-blur-2xl backdrop-saturate-150",
              maxWidthClassName,
              className,
            )}
            {...props}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute right-sm top-sm flex h-7 w-7 items-center justify-center rounded-full bg-divider-soft text-ink-muted-48 transition-transform duration-150 ease-out active:scale-90"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
