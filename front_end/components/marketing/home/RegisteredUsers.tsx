"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

type LiveStats = {
  registeredUsers: number;
  personasCreated: number;
  messagesExchanged: number;
};

const statDefinitions: { key: keyof LiveStats; label: string }[] = [
  { key: "personasCreated", label: "personas created" },
  { key: "messagesExchanged", label: "messages exchanged" },
  { key: "registeredUsers", label: "registered users" },
];

function formatted(value: number | null) {
  if (value === null) return "—";
  const concise = (number: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(number);
  if (value >= 1_000_000) return `${concise(value / 1_000_000)}M`;
  if (value >= 1_000) return `${concise(value / 1_000)}k`;
  return String(value);
}

export function LiveStats() {
  const [stats, setStats] = useState<LiveStats | null>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const response = await fetch("/api/public/stats", { cache: "no-store" });
        const data = await response.json() as Partial<LiveStats>;
        if (
          !cancelled &&
          response.ok &&
          typeof data.registeredUsers === "number" &&
          typeof data.personasCreated === "number" &&
          typeof data.messagesExchanged === "number"
        ) setStats(data as LiveStats);
      } catch {
        // Keep the last successful count visible if a refresh is interrupted.
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <>
      {statDefinitions.map(({ key, label }) => {
        const count = stats?.[key] ?? null;
        return (
          <div key={key} className="flex flex-col items-center text-center">
            <p className="flex justify-center font-display text-display-md text-on-dark" aria-live="polite" aria-label={`${count ?? "Loading"} ${label}`}>
              {formatted(count).split("").map((character, index) => (
                <span key={index} className="relative inline-grid h-[1.47em] min-w-[0.58em] overflow-hidden text-center">
                  <AnimatePresence initial={false} mode="popLayout">
                    <motion.span
                      key={`${index}-${character}`}
                      initial={reduceMotion ? false : { opacity: 0, y: "-65%" }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduceMotion ? undefined : { opacity: 0, y: "70%" }}
                      transition={{ duration: reduceMotion ? 0 : 0.2, ease: "easeOut" }}
                      className="col-start-1 row-start-1"
                    >
                      {character}
                    </motion.span>
                  </AnimatePresence>
                </span>
              ))}
            </p>
            <p className="mt-xxs font-text text-caption text-body-muted">{label}</p>
          </div>
        );
      })}
    </>
  );
}
