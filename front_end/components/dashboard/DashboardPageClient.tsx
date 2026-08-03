"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DashboardShell } from "@/front_end/components/dashboard/DashboardShell";
import { useAuth } from "@/front_end/state/auth-context";

type PersonaSummary = {
  id: string;
  name: string;
  status: string;
  videoReady: boolean;
  trainingStartedAt: string | null;
};

type ListPersonasResponse =
  | { ok: true; personas: PersonaSummary[] }
  | { ok: false; error: string };

/**
 * Deliberately fetches user-specific dashboard data in the browser. The
 * server route remains a small authenticated JSON query, while this page's
 * HTML can be served without invoking Prisma/Hyperdrive during SSR.
 */
export function DashboardPageClient() {
  const { status, user } = useAuth();
  const router = useRouter();
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [personasLoading, setPersonasLoading] = useState(true);

  const refreshPersonas = useCallback(async () => {
    if (!user?.emailVerified) return;
    try {
      const response = await fetch("/api/personas", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const result = await response.json() as ListPersonasResponse;
      if (result.ok) setPersonas(result.personas);
    } finally {
      setPersonasLoading(false);
    }
  }, [user?.emailVerified]);

  useEffect(() => {
    if (status === "loading") return;
    if (!user?.emailVerified) {
      router.replace("/?authRequired=1");
      return;
    }
    void refreshPersonas();
  }, [status, user?.emailVerified, router, refreshPersonas]);

  const dashboardUser = useMemo(() => user ? {
    id: user.id,
    username: user.username,
    profileImageUrl: user.profileImageUrl,
    subscriptionStatus: user.subscription.status,
    subscriptionRenewsAt: user.subscription.currentPeriodEnd,
  } : null, [user]);

  if (status === "loading" || !dashboardUser || personasLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-canvas-parchment px-lg">
        <p className="font-text text-caption text-ink-muted-48">Loading your dashboard…</p>
      </div>
    );
  }

  return <DashboardShell user={dashboardUser} personas={personas} onPersonasChanged={refreshPersonas} />;
}
