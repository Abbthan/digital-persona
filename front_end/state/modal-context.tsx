"use client";

import { createContext, ReactNode, useContext, useState } from "react";

export type ModalName = "auth" | "pricing" | "account-settings";
export type AuthTab = "login" | "register";

type OpenModalOptions = {
  authTab?: AuthTab;
  /** Shown at the top of the pricing modal, e.g. explaining why it opened. */
  pricingReason?: string;
};

type ModalContextValue = {
  activeModal: ModalName | null;
  authTab: AuthTab;
  pricingReason: string | null;
  openModal: (name: ModalName, options?: OpenModalOptions) => void;
  closeModal: () => void;
  setAuthTab: (tab: AuthTab) => void;
};

const ModalContext = createContext<ModalContextValue | null>(null);

// Shared so any component (dock, page CTAs, dashboard sidebar in later
// phases) can open the same modal instances instead of each owning its own
// open/closed state. "auth" covers both login and register — Phase 5 makes
// it a real tabbed modal; authTab just tracks which tab should be active.
export function ModalProvider({ children }: { children: ReactNode }) {
  const [activeModal, setActiveModal] = useState<ModalName | null>(null);
  const [authTab, setAuthTab] = useState<AuthTab>("register");
  const [pricingReason, setPricingReason] = useState<string | null>(null);

  return (
    <ModalContext.Provider
      value={{
        activeModal,
        authTab,
        pricingReason,
        openModal: (name, options) => {
          if (name === "auth" && options?.authTab) setAuthTab(options.authTab);
          if (name === "pricing") setPricingReason(options?.pricingReason ?? null);
          setActiveModal(name);
        },
        closeModal: () => setActiveModal(null),
        setAuthTab,
      }}
    >
      {children}
    </ModalContext.Provider>
  );
}

export function useModalController() {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("useModalController must be used within ModalProvider");
  return ctx;
}
