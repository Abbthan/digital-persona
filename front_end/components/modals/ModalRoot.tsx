"use client";

import { AccountSettingsModal } from "@/front_end/components/modals/AccountSettingsModal";
import { AuthModal } from "@/front_end/components/modals/AuthModal";
import { PricingModal } from "@/front_end/components/modals/PricingModal";

// Each modal mounts once and reads `open` from useModalController itself, so
// this can live in the root layout and any component can trigger any modal
// via useModalController().openModal(...).
export function ModalRoot() {
  return (
    <>
      <AuthModal />
      <PricingModal />
      <AccountSettingsModal />
    </>
  );
}
