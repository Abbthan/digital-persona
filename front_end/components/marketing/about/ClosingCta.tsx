"use client";

import Link from "next/link";
import { Button, buttonBaseClass, buttonVariantClasses } from "@/front_end/components/ui";
import { Section } from "@/front_end/components/marketing/Section";
import { cn } from "@/shared/utils";
import { useModalController } from "@/front_end/state/modal-context";

export function ClosingCta() {
  const { openModal } = useModalController();

  return (
    <Section tone="parchment">
      <h2 className="font-display text-display-lg text-ink">Ready to start the conversation?</h2>
      <p className="mt-xs max-w-[32rem] font-text text-body text-ink-muted-80">
        Create a persona in minutes, or see what&apos;s included in each plan.
      </p>

      <div className="mt-lg flex flex-col gap-sm sm:flex-row">
        <Button variant="primary" onClick={() => openModal("auth", { authTab: "register" })}>
          Get Started
        </Button>
        <Link href="/pricing" className={cn(buttonBaseClass, buttonVariantClasses.secondary)}>
          See Pricing
        </Link>
      </div>
    </Section>
  );
}
