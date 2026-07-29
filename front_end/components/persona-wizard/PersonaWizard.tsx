"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { NameModal } from "./NameModal";
import { UploadWizard } from "./UploadWizard";

type PersonaWizardProps = {
  open: boolean;
  onClose: () => void;
  onTrainingStarted: (persona: { id: string; name: string }) => void;
};

export function PersonaWizard({ open, onClose, onTrainingStarted }: PersonaWizardProps) {
  const router = useRouter();
  const [persona, setPersona] = useState<{ id: string; name: string } | null>(null);

  function handleClose() {
    setPersona(null);
    onClose();
  }

  function handleFinish() {
    if (persona) onTrainingStarted(persona);
    setPersona(null);
    onClose();
    router.refresh();
  }

  if (!open) return null;

  if (!persona) {
    return <NameModal open onClose={handleClose} onCreated={setPersona} />;
  }

  return <UploadWizard open personaId={persona.id} personaName={persona.name} onFinish={handleFinish} onCancel={handleClose} />;
}
