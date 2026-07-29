"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "@/front_end/state/auth-context";
import { isThemePreference, type ThemePreference } from "@/shared/appearance";

export type { ThemePreference } from "@/shared/appearance";
export type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

// Keep in sync with the inline script in app/layout.tsx, which reads this
// same key synchronously before first paint to avoid a flash of the wrong
// theme — this provider re-reads it on mount just to get React's state in
// sync with what that script already applied to the DOM.
export const THEME_STORAGE_KEY = "echo-theme-preference";

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? getSystemTheme() : preference;
}

function applyTheme(resolved: ResolvedTheme) {
  document.documentElement.dataset.theme = resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  // Starts "system"/"light" and corrects itself in the effect below — the
  // inline head script already applied the right data-theme attribute
  // before paint, so this initial mismatch is never visible, just briefly
  // inconsistent in React state until the effect runs.
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");
  const saveQueueRef = useRef(Promise.resolve());

  const applyPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
    const resolved = resolveTheme(next);
    setResolvedTheme(resolved);
    applyTheme(resolved);
  }, []);

  useEffect(() => {
    // Reading localStorage (an external, non-reactive source) to hydrate
    // initial state can't happen during render — window/localStorage aren't
    // available server-side, so this has to be an effect, and it's
    // genuinely synchronous (no await to hide behind, unlike auth-context's
    // refresh()). Legitimate one-time external-system sync on mount.
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    const initial = isThemePreference(stored) ? stored : "system";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    applyPreference(initial);
  }, [applyPreference]);

  // An authenticated account is the canonical source across browsers. Local
  // storage is deliberately only the guest/first-paint fallback, so a saved
  // account preference wins as soon as authentication finishes hydrating.
  useEffect(() => {
    if (status !== "authenticated" || !user) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    applyPreference(user.themePreference);
  }, [status, user, applyPreference]);

  // Only matters while on "system" — live-updates if the OS theme changes
  // while the app is open.
  useEffect(() => {
    if (preference !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    function handleChange() {
      const resolved = getSystemTheme();
      setResolvedTheme(resolved);
      applyTheme(resolved);
    }
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, [preference]);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      applyPreference(next);
      if (status !== "authenticated") return;

      // Serialize saves so a rapid Light → Dark → System interaction cannot
      // let a slower earlier request overwrite the final selection on the
      // account.
      saveQueueRef.current = saveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const response = await fetch("/api/account/theme", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            cache: "no-store",
            body: JSON.stringify({ themePreference: next }),
          });
          if (!response.ok) throw new Error("Couldn't save theme preference.");
        });
    },
    [applyPreference, status],
  );

  return (
    <ThemeContext.Provider value={{ preference, resolvedTheme, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
