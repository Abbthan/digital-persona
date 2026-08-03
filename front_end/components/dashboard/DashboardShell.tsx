"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { UserAvatar } from "@/front_end/components/account/UserAvatar";
import { LanguageToggle } from "@/front_end/components/LanguageToggle";
import { PersonaConversationView } from "@/front_end/components/dashboard/PersonaConversationView";
import { CommunityConversationView } from "@/front_end/components/dashboard/CommunityConversationView";
import { PersonaManagerModal } from "@/front_end/components/dashboard/PersonaManagerModal";
import { PersonaTrainingProgress, type TrainingPersonaSummary } from "@/front_end/components/dashboard/PersonaTrainingProgress";
import { PersonaWizard } from "@/front_end/components/persona-wizard/PersonaWizard";
import { personaLimitFor } from "@/back_end/services/limits";
import { useModalController } from "@/front_end/state/modal-context";
import { cn } from "@/shared/utils";

type PersonaSummary = {
  id: string;
  name: string;
  status: string;
  videoReady: boolean;
  trainingStartedAt: string | null;
};

type DashboardShellProps = {
  user: {
    id: string;
    username: string;
    profileImageUrl: string | null;
    subscriptionStatus: string | null;
    subscriptionRenewsAt: Date | string | null;
  };
  personas: PersonaSummary[];
  /** Refreshes the client-side persona list after a mutation or training state change. */
  onPersonasChanged?: () => void;
};

const navItem =
  "flex items-center justify-between rounded-md px-sm py-xs font-text text-body text-ink transition-transform duration-150 ease-out active:scale-[0.99]";

export function DashboardShell({ user, personas, onPersonasChanged }: DashboardShellProps) {
  const [personasExpanded, setPersonasExpanded] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [communityOpen, setCommunityOpen] = useState(false);
  const [managedPersona, setManagedPersona] = useState<PersonaSummary | null>(null);
  const [deletedPersonaIds, setDeletedPersonaIds] = useState<string[]>([]);
  const [newlyPreparing, setNewlyPreparing] = useState<PersonaSummary | null>(null);
  const [trainingModalPersonaId, setTrainingModalPersonaId] = useState<string | null>(null);
  const { openModal } = useModalController();
  const reduceMotion = useReducedMotion();
  const limit = personaLimitFor(user.subscriptionStatus, user.subscriptionRenewsAt);
  // Remove a deleted persona from this render immediately, before the server
  // refresh returns the updated account list. This also makes a stale selected
  // ID fall back to the single empty conversation pane instead of lingering.
  const visiblePersonas = personas.filter((persona) => !deletedPersonaIds.includes(persona.id));
  const atLimit = visiblePersonas.length >= limit;
  const selectedPersona = visiblePersonas.find((persona) => persona.id === selectedPersonaId) ?? null;
  const trainingPersonas = useMemo<TrainingPersonaSummary[]>(() => {
    const fromServer = visiblePersonas.filter((persona) => persona.status === "processing");
    if (newlyPreparing && !fromServer.some((persona) => persona.id === newlyPreparing.id)) {
      return [...fromServer, newlyPreparing];
    }
    return fromServer;
  }, [visiblePersonas, newlyPreparing]);

  function handleCreateClick() {
    setMobileMenuOpen(false);
    if (atLimit) {
      openModal("pricing", {
        pricingReason: `You've reached your plan's limit of ${limit} persona${limit === 1 ? "" : "s"}. Upgrade to create more.`,
      });
      return;
    }
    setWizardOpen(true);
  }

  function selectPersona(personaId: string) {
    setSelectedPersonaId(personaId);
    setCommunityOpen(false);
    // On a narrow viewport, return the focus to the conversation after a
    // persona is selected instead of leaving the full navigation open above it.
    setMobileMenuOpen(false);
  }

  function openCommunity() {
    setSelectedPersonaId(null);
    setCommunityOpen(true);
    setMobileMenuOpen(false);
  }

  function openAccountSettings() {
    setMobileMenuOpen(false);
    openModal("account-settings");
  }

  function openPricing() {
    setMobileMenuOpen(false);
    openModal("pricing");
  }

  function openPersonaManager(persona: PersonaSummary) {
    setMobileMenuOpen(false);
    setManagedPersona(persona);
  }

  function handlePersonaDeleted(personaId: string) {
    setDeletedPersonaIds((deleted) => [...deleted, personaId]);
    setSelectedPersonaId((selectedId) => selectedId === personaId ? null : selectedId);
    setManagedPersona(null);
    onPersonasChanged?.();
  }

  function handleTrainingStarted(persona: { id: string; name: string }) {
    setNewlyPreparing({
      ...persona,
      status: "processing",
      videoReady: false,
      trainingStartedAt: new Date().toISOString(),
    });
    setTrainingModalPersonaId(persona.id);
    onPersonasChanged?.();
  }

  const handleTrainingCompleted = useCallback((personaId: string) => {
    setNewlyPreparing((current) => current?.id === personaId ? null : current);
    setTrainingModalPersonaId((current) => current === personaId ? null : current);
    onPersonasChanged?.();
  }, [onPersonasChanged]);

  function openTrainingProgress() {
    setTrainingModalPersonaId(trainingPersonas[0]?.id ?? null);
  }

  function navigationItems() {
    return (
      <>
        <button onClick={() => setPersonasExpanded((expanded) => !expanded)} className={navItem}>
          <span>Personas</span>
          <span className="font-text text-caption text-ink-muted-48">
            {visiblePersonas.length}/{limit}
          </span>
        </button>

        {/* grid-template-rows 0fr/1fr animates to content height without a
            fixed max-height guess — pushes content below it down smoothly
            rather than overlapping, per Phase 6's explicit requirement. */}
        <div
          className="grid transition-[grid-template-rows] duration-300 ease-out"
          style={{ gridTemplateRows: personasExpanded ? "1fr" : "0fr" }}
        >
          <div className="flex min-h-0 flex-col gap-xxs overflow-hidden pl-sm">
            {visiblePersonas.length === 0 ? (
              <p className="px-sm py-xs font-text text-caption text-ink-muted-48">No personas yet</p>
            ) : (
              visiblePersonas.map((persona) => (
                <div key={persona.id} className="group relative flex min-w-0 items-center">
                  <button
                    onClick={() => selectPersona(persona.id)}
                    className={cn(
                      "min-w-0 flex-1 truncate rounded-md px-sm py-xs pr-9 text-left font-text text-caption transition-transform duration-150 ease-out active:scale-[0.99]",
                      persona.id === selectedPersonaId
                        ? "bg-canvas-parchment text-ink"
                        : "text-ink",
                    )}
                  >
                    {persona.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Manage ${persona.name}`}
                    onClick={() => openPersonaManager(persona)}
                    className={cn(
                      "absolute right-xxs flex h-7 w-7 items-center justify-center rounded-full text-ink-muted-48 transition-[opacity,color,transform] duration-150 ease-out hover:text-ink active:scale-90 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus",
                      persona.id === selectedPersonaId ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                    )}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <circle cx="3" cy="7" r="1" fill="currentColor" />
                      <circle cx="7" cy="7" r="1" fill="currentColor" />
                      <circle cx="11" cy="7" r="1" fill="currentColor" />
                    </svg>
                  </button>
                </div>
              ))
            )}
            <button
              onClick={handleCreateClick}
              className="mt-xxs rounded-md border border-hairline px-sm py-xs text-left font-text text-caption-strong text-primary transition-transform duration-150 ease-out active:scale-[0.99]"
            >
              Create +
            </button>
          </div>
        </div>

        <button onClick={openCommunity} className={cn(navItem, communityOpen ? "bg-canvas-parchment" : "")}>
          <span>Community</span>
        </button>
        <button onClick={openPricing} className={navItem}>
          <span>Pricing</span>
        </button>
        <Link href="/dashboard/order-teddy" className={navItem}>
          <span>Order Teddy</span>
        </Link>
        <Link href="/" className={navItem}>
          <span>Return Home</span>
        </Link>
        <div className="mt-auto flex justify-start border-t border-hairline pt-sm">
          <LanguageToggle />
        </div>
      </>
    );
  }

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col gap-lg bg-canvas-parchment px-lg py-lg md:flex-row">
      <aside className="relative z-30 flex w-full flex-shrink-0 flex-col overflow-visible rounded-lg border border-hairline bg-canvas p-lg md:w-72 md:overflow-y-auto">
        <div className="flex items-center justify-between gap-sm">
          <button
            onClick={openAccountSettings}
            className="flex min-w-0 items-center gap-sm rounded-md p-xs text-left transition-transform duration-150 ease-out active:scale-[0.99]"
          >
            <UserAvatar
              username={user.username}
              profileImageUrl={user.profileImageUrl}
              className="h-9 w-9"
            />
            <span className="truncate font-text text-body-strong text-ink">{user.username}</span>
          </button>
          <button
            type="button"
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-expanded={mobileMenuOpen}
            aria-controls="dashboard-navigation"
            className="rounded-md px-sm py-xs font-text text-caption text-ink-muted-80 transition-transform duration-150 ease-out active:scale-[0.95] md:hidden"
          >
            {mobileMenuOpen ? "Close" : "Menu"}
          </button>
        </div>
        <PersonaTrainingProgress
          personas={trainingPersonas}
          modalPersonaId={trainingModalPersonaId}
          onCloseModal={() => trainingModalPersonaId ? setTrainingModalPersonaId(null) : openTrainingProgress()}
          onCompleted={handleTrainingCompleted}
        />

        <nav className="mt-lg hidden min-h-0 flex-1 flex-col gap-xxs md:flex">
          {navigationItems()}
        </nav>

        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.nav
              id="dashboard-navigation"
              initial={{ opacity: 0, y: -8, scaleY: 0.95 }}
              animate={{ opacity: 1, y: 0, scaleY: 1 }}
              exit={{ opacity: 0, y: -8, scaleY: 0.95 }}
              transition={{ duration: reduceMotion ? 0 : 0.28, ease: "easeInOut" }}
              style={{ transformOrigin: "top" }}
              className="absolute left-0 top-full z-10 mt-xs flex max-h-[calc(100dvh-9rem)] w-full flex-col gap-xxs overflow-y-auto rounded-lg border border-hairline bg-canvas p-lg shadow-dock overscroll-contain md:hidden"
            >
              {navigationItems()}
            </motion.nav>
          )}
        </AnimatePresence>
      </aside>

      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.button
            type="button"
            aria-label="Close dashboard menu"
            onClick={() => setMobileMenuOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.28, ease: "easeInOut" }}
            className="fixed inset-0 z-20 bg-surface-black/40 backdrop-blur-sm md:hidden"
          />
        )}
      </AnimatePresence>

      <main className="flex min-h-0 flex-1">
        {communityOpen ? (
          <CommunityConversationView currentUserId={user.id} />
        ) : selectedPersona?.status === "processing" ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-lg border border-hairline bg-canvas p-lg text-center">
            <p className="font-text text-body-strong text-ink">Preparing {selectedPersona.name}</p>
            <p className="mt-xs font-text text-caption text-ink-muted-48">This persona will be ready as soon as its uploads are prepared.</p>
            <button type="button" onClick={openTrainingProgress} className="mt-sm font-text text-caption text-primary">View progress</button>
          </div>
        ) : selectedPersona ? (
          <PersonaConversationView
            key={selectedPersona.id}
            personaId={selectedPersona.id}
            personaName={selectedPersona.name}
            videoReady={selectedPersona.videoReady}
          />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-hairline bg-canvas">
          <p className="font-text text-body text-ink-muted-48">Select or create a persona to get started</p>
          </div>
        )}
      </main>

      <PersonaWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onTrainingStarted={handleTrainingStarted} />
      <PersonaManagerModal
        key={managedPersona?.id ?? "no-managed-persona"}
        persona={managedPersona}
        onClose={() => setManagedPersona(null)}
        onPersonaDeleted={handlePersonaDeleted}
      />
    </div>
  );
}
