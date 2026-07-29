"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/front_end/components/ui";
import type { PersonaTrainingResponseBody } from "@/back_end/api/personas/[id]/training/route";

export type TrainingPersonaSummary = { id: string; name: string; status: string };

type PersonaTrainingProgressProps = {
  personas: TrainingPersonaSummary[];
  modalPersonaId: string | null;
  onCloseModal: () => void;
  onCompleted: (personaId: string) => void;
};

export function PersonaTrainingProgress({ personas, modalPersonaId, onCloseModal, onCompleted }: PersonaTrainingProgressProps) {
  const processingPersonas = useMemo(() => personas.filter((persona) => persona.status === "processing"), [personas]);
  const processingKey = processingPersonas.map((persona) => persona.id).join(":");
  const [progressByPersona, setProgressByPersona] = useState<Record<string, number>>({});
  const completedIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (processingPersonas.length === 0) return;
    let cancelled = false;
    async function poll() {
      const completed: string[] = [];
      const entries = await Promise.all(processingPersonas.map(async (persona) => {
        try {
          const response = await fetch(`/api/personas/${persona.id}/training`, { cache: "no-store" });
          const result = await response.json() as PersonaTrainingResponseBody;
          if (!result.ok) return null;
          if (result.status === "active" && !completedIdsRef.current.has(persona.id)) {
            completedIdsRef.current.add(persona.id);
            completed.push(persona.id);
          }
          if (result.status === "processing") completedIdsRef.current.delete(persona.id);
          return [persona.id, result.progress] as const;
        } catch {
          return null;
        }
      }));
      if (cancelled) return;
      setProgressByPersona((current) => ({ ...current, ...Object.fromEntries(entries.filter(Boolean) as [string, number][]) }));
      completed.forEach(onCompleted);
    }
    void poll();
    // Polling a GPU task several times per second multiplied each active
    // dashboard into a stream of Worker → A800 → database requests. Training
    // progress is not latency-sensitive; a three-second cadence is plenty
    // while materially reducing concurrent Worker invocations.
    const interval = window.setInterval(() => void poll(), 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [processingKey, onCompleted, processingPersonas]);

  const modalPersona = processingPersonas.find((persona) => persona.id === modalPersonaId) ?? null;
  const modalProgress = modalPersona ? progressByPersona[modalPersona.id] ?? 0 : 0;

  return (
    <>
      {processingPersonas.length > 0 && (
        <button
          type="button"
          onClick={() => onCloseModal()}
          className="mt-sm w-full rounded-md border border-hairline bg-canvas-parchment p-sm text-left"
          aria-label="Show persona preparation progress"
        >
          <div className="flex items-center justify-between gap-xs">
            <span className="truncate font-text text-fine-print text-ink">Preparing {processingPersonas.length === 1 ? processingPersonas[0].name : `${processingPersonas.length} personas`}</span>
            <span className="font-text text-fine-print text-ink-muted-48">{Math.max(...processingPersonas.map((persona) => progressByPersona[persona.id] ?? 0))}%</span>
          </div>
          <div className="mt-xxs h-1.5 overflow-hidden rounded-pill bg-divider-soft">
            <div className="h-full rounded-pill bg-primary transition-[width] duration-300 ease-out" style={{ width: `${Math.max(...processingPersonas.map((persona) => progressByPersona[persona.id] ?? 0))}%` }} />
          </div>
        </button>
      )}

      <Modal open={modalPersona !== null} onClose={onCloseModal} maxWidthClassName="max-w-[28rem]">
        {modalPersona && (
          <>
            <h2 className="font-display text-tagline text-ink">Preparing {modalPersona.name}</h2>
            <p className="mt-xs font-text text-caption text-ink-muted-80">
              Your uploads are being prepared for this persona. You can close this window; preparation will continue.
            </p>
            <div className="mt-lg h-2 overflow-hidden rounded-pill bg-divider-soft">
              <div className="h-full rounded-pill bg-primary transition-[width] duration-300 ease-out" style={{ width: `${modalProgress}%` }} />
            </div>
            <p className="mt-xs text-right font-text text-caption text-ink-muted-48">{modalProgress}%</p>
          </>
        )}
      </Modal>
    </>
  );
}
