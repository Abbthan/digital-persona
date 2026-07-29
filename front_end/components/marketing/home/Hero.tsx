"use client";

import Link from "next/link";
import Image from "next/image";
import { Button, buttonBaseClass, buttonVariantClasses } from "@/front_end/components/ui";
import { Section } from "@/front_end/components/marketing/Section";
import { HeroGradientBackground } from "@/front_end/components/marketing/home/HeroGradientBackground";
import { cn } from "@/shared/utils";
import { useModalController } from "@/front_end/state/modal-context";

export function Hero() {
  const { openModal } = useModalController();

  return (
    // sticky rather than the section's default relative (overridden with
    // !sticky since cn() here is a plain join, not a Tailwind-conflict-aware
    // merge — see shared/utils.ts): the hero stays pinned at the top of the
    // viewport as its normal document-flow space scrolls by, so HowItWorks
    // (the next section, opaque and later in DOM order) slides up and
    // visually covers it instead of the two scrolling together. z-0 keeps it
    // unambiguously beneath that later content.
    <Section
      tone="canvas"
      clearDock
      className="!sticky top-0 z-0 !pb-32"
      background={<HeroGradientBackground />}
    >
      <Image
        src="/brand/echo-logo.png"
        alt="ECHO logo"
        width={192}
        height={192}
        className="h-40 w-40 sm:h-48 sm:w-48"
        priority
      />
      {/* text-white rather than text-ink: this section's own gradient
          background is now busy/saturated enough that the app's usual dark
          ink color wouldn't read well against it. Dark mode is effectively
          unaffected — its ink color is already near-white (#f5f5f7). */}
      <h1 className="mt-sm font-display text-hero-display text-white">ECHO 回响</h1>
      <p className="mt-sm max-w-[36rem] font-display text-lead text-white">
        Bring someone back into the conversation — create their AI persona from photos,
        video, audio, chat history, and social media.
      </p>

      <div className="mt-lg flex flex-col justify-center gap-sm sm:flex-row">
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
