"use client";

import { PricingSection } from "@/front_end/components/billing/PricingSection";
import { Modal } from "@/front_end/components/ui";
import { useModalController } from "@/front_end/state/modal-context";

export function PricingModal() {
  const { activeModal, closeModal, pricingReason } = useModalController();

  return (
    <Modal
      open={activeModal === "pricing"}
      onClose={closeModal}
      maxWidthClassName="max-w-[52rem]"
      className="flex max-h-[calc(100dvh-3rem)] flex-col overflow-hidden p-lg sm:p-xl"
    >
      <h2 className="flex-shrink-0 font-display text-tagline text-ink">Pricing</h2>
      {pricingReason && (
        <p className="mt-xs flex-shrink-0 font-text text-caption text-red-500">{pricingReason}</p>
      )}
      <div className="mt-md flex-shrink-0">
        <p className="max-w-[36rem] font-text text-body text-ink-muted-80">
          Start free with text. Purchase a plan for real-time voice and video.
        </p>
        <p className="mt-xs max-w-[40rem] font-text text-caption text-ink-muted-48">
          Every plan is a one-time purchase, not a recurring subscription — it never auto-renews or
          charges you again. Purchasing more time while a plan is still active simply adds to it and
          pushes out your expiry date.
        </p>
      </div>
      <div className="mt-lg min-h-0 flex-1 overflow-y-auto overscroll-contain pr-xs">
        <PricingSection />
      </div>
    </Modal>
  );
}
