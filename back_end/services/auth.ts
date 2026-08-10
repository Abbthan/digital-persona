import { getDb } from "@/back_end/services/db";
import { getSession } from "@/back_end/services/session";
import { isThemePreference, type ThemePreference } from "@/shared/appearance";
import { isLanguagePreference, type LanguagePreference } from "@/shared/i18n";
import { emailFormatError, passwordFormatError, usernameFormatError } from "@/shared/validation";

export function validateUsername(username: string): string | null {
  return usernameFormatError(username);
}

export function validateEmail(email: string): string | null {
  return emailFormatError(email);
}

export function validatePassword(password: string): string | null {
  return passwordFormatError(password);
}

export type CurrentUser = {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
  profileImageUrl: string | null;
  themePreference: ThemePreference;
  languagePreference: LanguagePreference;
  subscriptionPlan: string | null;
  subscriptionStatus: string | null;
  subscriptionRenewsAt: Date | null;
};

const currentUserSelect = {
  id: true,
  username: true,
  email: true,
  emailVerified: true,
  profileImageUrl: true,
  themePreference: true,
  languagePreference: true,
  subscriptionPlan: true,
  subscriptionStatus: true,
  subscriptionRenewsAt: true,
} as const;

export async function getCurrentUser(
  { refreshSession = false }: { refreshSession?: boolean } = {},
): Promise<CurrentUser | null> {
  const session = await getSession();
  if (!session.userId) return null;
  const db = getDb();
  const user = await db.user.findUnique({ where: { id: session.userId }, select: currentUserSelect });

  if (!user) return null;

  // The database default and write endpoint only allow the three options, but
  // fall back defensively so an unexpected legacy value never breaks account
  // hydration in the browser.
  const currentUser: CurrentUser = {
    ...user,
    themePreference: isThemePreference(user.themePreference) ? user.themePreference : "system",
    languagePreference: isLanguagePreference(user.languagePreference) ? user.languagePreference : "system",
  };

  // The auth-state endpoint calls this with refreshSession enabled. It turns
  // any pre-existing session cookie into the current persistent format and
  // provides a rolling 30-day sign-in while the user continues using this
  // browser. Server-rendered pages leave it off because they cannot set
  // cookies during rendering.
  if (refreshSession) await session.save();

  return currentUser;
}
