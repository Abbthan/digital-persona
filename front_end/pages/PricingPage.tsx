import { PricingSection } from "@/front_end/components/billing/PricingSection";

export default function PricingPage() {
  return (
    <main className="flex flex-1 flex-col items-center bg-canvas px-lg pt-32 pb-section text-center">
      <p className="font-text text-caption-strong text-ink-muted-48">Pricing</p>
      <h1 className="mt-xs font-display text-display-lg text-ink">
        One conversation, three ways to keep it going
      </h1>
      <p className="mt-md w-full max-w-[36rem] font-text text-body text-ink-muted-80">
        Start free with text. Purchase a plan for real-time voice and video.
      </p>
      <p className="mt-xs w-full max-w-[36rem] font-text text-caption text-ink-muted-48">
        Every plan is a one-time purchase, not a recurring subscription — it never auto-renews or
        charges you again. Purchasing more time while a plan is still active simply adds to it and
        pushes out your expiry date.
      </p>

      <div className="mt-xxl w-full max-w-[64rem]">
        <PricingSection />
      </div>
    </main>
  );
}
