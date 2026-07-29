"use client";

import { Button } from "@/front_end/components/ui";
import { Section } from "@/front_end/components/marketing/Section";
import { useModalController } from "@/front_end/state/modal-context";

export function FinalCta() {
  const { openModal } = useModalController();

  return (
    <Section tone="parchment">
      <h2 className="font-display text-display-lg text-ink">Keep the conversation going</h2>
      <p className="mt-xs max-w-[32rem] font-text text-body text-ink-muted-80">
        Create your first persona in minutes — free to start.
      </p>
      <Button variant="primary" className="mt-lg" onClick={() => openModal("auth", { authTab: "register" })}>
        Get Started
      </Button>
    </Section>
  );
}
