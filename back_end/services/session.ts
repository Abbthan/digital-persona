import { cookies } from "next/headers";
import { getIronSession, type IronSession } from "iron-session";

export type SessionData = {
  userId?: string;
};

// Keep the browser cookie and the encrypted iron-session seal valid for the
// same period. A persistent cookie alone is not enough if its seal expires
// earlier, and a long-lived seal is not useful if the browser discards the
// cookie on tab close.
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) {
  // iron-session requires a >=32 char secret. Fail loudly at import time
  // rather than silently issuing broken sessions.
  console.warn(
    "SESSION_SECRET is missing or shorter than 32 characters — sessions will fail. " +
      "Set a real value in .env (see .env.example).",
  );
}

export async function getSession(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(await cookies(), {
    cookieName: "echo_session",
    password: sessionSecret ?? "dev-only-insecure-secret-please-set-a-real-one-in-env",
    ttl: SESSION_TTL_SECONDS,
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      // Both attributes make this a persistent, same-browser cookie. `expires`
      // provides a browser-compatible fallback for clients that do not retain
      // a Max-Age-only cookie after restarting.
      maxAge: SESSION_TTL_SECONDS,
      expires: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
      priority: "high",
    },
  });
}
