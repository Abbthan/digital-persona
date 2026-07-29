"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { hasPaidAccess } from "@/back_end/services/limits";
import type { ThemePreference } from "@/shared/appearance";
import type { LanguagePreference } from "@/shared/i18n";
import type { PlanId } from "@/shared/pricing";
import type { CurrentUser } from "@/back_end/services/auth";

export type SubscriptionState = {
  plan: PlanId | null;
  status: "none" | "active";
  currentPeriodEnd: string | null;
};

export type SessionUser = {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
  profileImageUrl: string | null;
  themePreference: ThemePreference;
  languagePreference: LanguagePreference;
  subscription: SubscriptionState;
};

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthContextValue = {
  status: AuthStatus;
  user: SessionUser | null;
  isAuthenticated: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const AUTH_CACHE_STORAGE_KEY = "echo-auth-user-cache";

function toSessionUser(raw: CurrentUser): SessionUser {
  return {
    id: raw.id,
    username: raw.username,
    email: raw.email,
    emailVerified: raw.emailVerified,
    profileImageUrl: raw.profileImageUrl,
    themePreference: raw.themePreference,
    languagePreference: raw.languagePreference,
    subscription: {
      plan: raw.subscriptionPlan as PlanId | null,
      status: hasPaidAccess(raw.subscriptionStatus, raw.subscriptionRenewsAt) ? "active" : "none",
      currentPeriodEnd: raw.subscriptionRenewsAt ? raw.subscriptionRenewsAt.toString() : null,
    },
  };
}

function readCachedUser(): SessionUser | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(AUTH_CACHE_STORAGE_KEY) ?? "null") as Partial<SessionUser> | null;
    if (
      !parsed ||
      typeof parsed.id !== "string" ||
      typeof parsed.username !== "string" ||
      typeof parsed.email !== "string" ||
      typeof parsed.emailVerified !== "boolean" ||
      !parsed.subscription ||
      typeof parsed.subscription !== "object"
    ) return null;
    return parsed as SessionUser;
  } catch {
    return null;
  }
}

function writeCachedUser(user: SessionUser | null) {
  try {
    if (user) window.localStorage.setItem(AUTH_CACHE_STORAGE_KEY, JSON.stringify(user));
    else window.localStorage.removeItem(AUTH_CACHE_STORAGE_KEY);
  } catch {
    // Storage may be disabled; the cookie-backed server session remains the
    // source of truth and will simply hydrate normally in that browser.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<SessionUser | null>(null);
  // A slow /me response that began before logout must not restore the user
  // into the client state after the logout request has completed.
  const sessionRequestVersion = useRef(0);

  // Restore the last verified local account before paint. The canonical
  // /api/auth/me request below still runs immediately and clears this cache
  // if the session has ended, but ordinary Next.js page navigation never
  // flashes the Register button or drops the dock profile meanwhile.
  useLayoutEffect(() => {
    const cached = readCachedUser();
    if (!cached) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUser(cached);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus("authenticated");
  }, []);

  const refresh = useCallback(async () => {
    const requestVersion = ++sessionRequestVersion.current;
    try {
      const response = await fetch("/api/auth/me", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const data = (await response.json()) as { user: CurrentUser | null };
      if (requestVersion !== sessionRequestVersion.current) return;
      if (data.user) {
        const sessionUser = toSessionUser(data.user);
        setUser(sessionUser);
        writeCachedUser(sessionUser);
        setStatus("authenticated");
      } else {
        setUser(null);
        writeCachedUser(null);
        setStatus("unauthenticated");
      }
    } catch {
      if (requestVersion !== sessionRequestVersion.current) return;
      // A temporary connection failure must not make a previously verified
      // dock profile vanish. Keep the cache visible until the server gives a
      // definitive unauthenticated response on a later refresh.
      const cached = readCachedUser();
      if (cached) {
        setUser(cached);
        setStatus("authenticated");
        return;
      }
      setUser(null);
      writeCachedUser(null);
      setStatus("unauthenticated");
    }
  }, []);

  // Hydrate session on first load — fetching from an external source (the
  // server session) is the canonical valid use of an effect, but the
  // set-state-in-effect rule can't see that refresh()'s setState calls all
  // happen after an await, so it flags this as if it were synchronous.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  useEffect(() => {
    function syncOtherTab(event: StorageEvent) {
      if (event.key !== AUTH_CACHE_STORAGE_KEY) return;
      const cached = readCachedUser();
      setUser(cached);
      setStatus(cached ? "authenticated" : "unauthenticated");
    }
    window.addEventListener("storage", syncOtherTab);
    return () => window.removeEventListener("storage", syncOtherTab);
  }, []);

  const logout = useCallback(async () => {
    // Invalidate any in-flight refresh before the session is destroyed. This
    // prevents a stale response from showing the dock profile again.
    sessionRequestVersion.current += 1;
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    writeCachedUser(null);
    setStatus("unauthenticated");
  }, []);

  return (
    <AuthContext.Provider
      value={{ status, user, isAuthenticated: status === "authenticated", refresh, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
