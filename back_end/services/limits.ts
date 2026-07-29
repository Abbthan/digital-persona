export const FREE_PERSONA_LIMIT = 1;
export const PAID_PERSONA_LIMIT = 5;

// Purchases are one-time (no recurring billing, no cancellation, no
// scheduled expiry job) — paid access is computed lazily instead: "active"
// status AND a renewsAt still in the future. Once that date passes, every
// paid-gated check here naturally falls back to free-tier on its own,
// without needing a cron job to flip the status row. Previously-uploaded
// paid-only persona data is never deleted on expiry — it just stops being
// accessible until a new purchase is made (see PersonaConversationView /
// UploadWizard's paid gating), and becomes visible again the moment
// hasPaidAccess is true again.
export function hasPaidAccess(
  subscriptionStatus: string | null | undefined,
  subscriptionRenewsAt: Date | string | null | undefined,
): boolean {
  if (subscriptionStatus !== "active" || !subscriptionRenewsAt) return false;
  const renewsAt = subscriptionRenewsAt instanceof Date ? subscriptionRenewsAt : new Date(subscriptionRenewsAt);
  return renewsAt.getTime() > Date.now();
}

/** Reads the same subscriptionStatus/subscriptionRenewsAt fields User/CurrentUser both expose. */
export function personaLimitFor(
  subscriptionStatus: string | null | undefined,
  subscriptionRenewsAt: Date | string | null | undefined,
): number {
  return hasPaidAccess(subscriptionStatus, subscriptionRenewsAt) ? PAID_PERSONA_LIMIT : FREE_PERSONA_LIMIT;
}

export const PAID_ONLY_ASSET_TYPES = ["video", "facial_scan"] as const;

export function isAssetTypeAllowed(
  type: string,
  subscriptionStatus: string | null | undefined,
  subscriptionRenewsAt: Date | string | null | undefined,
): boolean {
  if (hasPaidAccess(subscriptionStatus, subscriptionRenewsAt)) return true;
  return !(PAID_ONLY_ASSET_TYPES as readonly string[]).includes(type);
}
