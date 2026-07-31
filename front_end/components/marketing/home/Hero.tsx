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
    // Plain normal-flow section — only the background layer itself
    // (HeroGradientBackground, position:fixed) stays pinned to the viewport
    // for the reveal effect. The section and its text/logo/buttons scroll
    // normally, same as any other content. !bg-transparent cancels
    // tone="canvas"'s own opaque bg-canvas fill (kept for its text-color
    // pairing) — left opaque, this normal-flow section would sit above the
    // negative-z-index fixed background in the stacking order and hide it
    // completely for as long as the section itself is on screen.
    <Section tone="canvas" clearDock className="!bg-transparent !pb-32" background={<HeroGradientBackground />}>
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
