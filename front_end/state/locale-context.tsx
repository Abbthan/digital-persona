"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { isSupportedLocale, localeFromSystemLanguage, type SupportedLocale } from "@/shared/i18n";
import { useAuth } from "@/front_end/state/auth-context";

type LocaleContextValue = {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  toggleLocale: () => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

// Kept in sync with the pre-paint script in app/layout.tsx. This preserves a
// visitor's choice across refreshes/new tabs even before they sign in.
export const LANGUAGE_STORAGE_KEY = "echo-language-preference";

// Server rendering has no document/localStorage, so it always produces "en".
// Starting client state at that same fixed value — rather than reading the
// pre-paint script's result here — keeps the client's first render pass
// identical to the server's, so hydration has nothing to reconcile. Reading
// it eagerly here used to make locale-derived attributes (LanguageToggle's
// aria-label/title) mismatch the server output whenever a visitor's real
// locale was "zh"; React does not patch up an attribute mismatch after
// hydration, so the flag was left permanently stuck on English while the
// page content (translated separately, after mount) correctly showed
// Chinese. detectClientLocale() below now runs the same lookup, but only
// from a layout effect, after the matching first commit is safely done.
function initialLocale(): SupportedLocale {
  return "en";
}

function detectClientLocale(): SupportedLocale {
  const prepaintLocale = document.documentElement.dataset.language;
  if (isSupportedLocale(prepaintLocale)) return prepaintLocale;
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return isSupportedLocale(stored) ? stored : localeFromSystemLanguage(navigator.language);
}

function applyLocale(locale: SupportedLocale) {
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  document.documentElement.dataset.language = locale;
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const [locale, setLocaleState] = useState<SupportedLocale>(initialLocale);
  const saveQueue = useRef(Promise.resolve());

  // Runs once, synchronously before paint, right after the hydration-safe
  // "en" commit above lands — this is what actually applies the visitor's
  // real locale (pre-paint dataset / saved preference / system language).
  // useLayoutEffect (not useEffect) so this and LocaleTextTranslator's own
  // layout effect both flush before the browser paints, instead of the flag
  // and page content updating a frame apart.
  useLayoutEffect(() => {
    const detected = detectClientLocale();
    // One-time correction of the SSR-fixed "en" default to the real client
    // locale, not a state/external-system sync that runs on every render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (detected !== locale) setLocaleState(detected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    applyLocale(locale);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  }, [locale]);

  // Account preferences follow a visitor to every browser/device. A legacy
  // "system" value deliberately leaves the local, system-derived choice in
  // place until the visitor explicitly chooses a language. Adjusted during
  // render (React's documented pattern for deriving state from a changed
  // prop, https://react.dev/learn/you-might-not-need-an-effect) rather than
  // in an effect — the guard against syncedAccountPreference makes sure
  // this only fires once per distinct account value, not every render.
  const accountPreference =
    status === "authenticated" && user && isSupportedLocale(user.languagePreference) ? user.languagePreference : null;
  const [syncedAccountPreference, setSyncedAccountPreference] = useState<SupportedLocale | null>(null);
  if (accountPreference !== syncedAccountPreference) {
    if (accountPreference) setLocaleState(accountPreference);
    // Also clears on logout (accountPreference becomes null): without this,
    // signing into a second account in the same tab whose saved preference
    // happens to match the first account's last-synced value would compare
    // equal against that stale leftover and silently skip applying it.
    setSyncedAccountPreference(accountPreference);
  }

  const setLocale = useCallback((next: SupportedLocale) => {
    setLocaleState(next);
    if (status !== "authenticated") return;

    saveQueue.current = saveQueue.current
      .catch(() => undefined)
      .then(async () => {
        const response = await fetch("/api/account/language", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          cache: "no-store",
          body: JSON.stringify({ languagePreference: next }),
        });
        if (!response.ok) throw new Error("Couldn't save language preference.");
      });
  }, [status]);

  const toggleLocale = useCallback(() => setLocale(locale === "zh" ? "en" : "zh"), [locale, setLocale]);

  return <LocaleContext.Provider value={{ locale, setLocale, toggleLocale }}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used within LocaleProvider");
  return context;
}
