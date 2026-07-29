"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useModalController } from "@/front_end/state/modal-context";

// Reacting to a URL query param is a legitimate external-sync use of an
// effect — /dashboard redirects here with ?authRequired=1 when a gated
// route bounces an unauthenticated/unverified visitor home.
export function AuthRequiredHandler() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { openModal } = useModalController();

  useEffect(() => {
    if (searchParams.get("authRequired") === "1") {
      openModal("auth", { authTab: "login" });
      router.replace("/");
    }
  }, [searchParams, router, openModal]);

  return null;
}
