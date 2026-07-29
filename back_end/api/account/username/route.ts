import { NextRequest, NextResponse } from "next/server";
import { validateUsername } from "@/back_end/services/auth";
import { getDb } from "@/back_end/services/db";
import { getSession } from "@/back_end/services/session";

export type ChangeUsernameResponseBody =
  | { ok: true; username: string }
  | { ok: false; error: string; rateLimited?: boolean };

const USERNAME_CHANGE_LIMIT = 2;
const USERNAME_CHANGE_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  const db = getDb();
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json<ChangeUsernameResponseBody>(
      { ok: false, error: "You're not logged in." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim() : "";

  const usernameError = validateUsername(username);
  if (usernameError) {
    return NextResponse.json<ChangeUsernameResponseBody>(
      { ok: false, error: usernameError },
      { status: 400 },
    );
  }

  try {
    const currentUser = await db.user.findUnique({ where: { id: session.userId } });
    if (!currentUser) {
      return NextResponse.json<ChangeUsernameResponseBody>(
        { ok: false, error: "Account not found." },
        { status: 404 },
      );
    }

    // No-op: not an actual change, so it shouldn't cost one of the 2 slots.
    if (username === currentUser.username) {
      return NextResponse.json<ChangeUsernameResponseBody>({ ok: true, username });
    }

    // Same uniqueness check as registration.
    const existing = await db.user.findUnique({ where: { username } });
    if (existing && existing.id !== session.userId) {
      return NextResponse.json<ChangeUsernameResponseBody>(
        { ok: false, error: "That username is taken." },
        { status: 409 },
      );
    }

    const windowStart = new Date(Date.now() - USERNAME_CHANGE_WINDOW_MS);
    const recentChangeCount = await db.usernameChange.count({
      where: { userId: session.userId, createdAt: { gte: windowStart } },
    });
    if (recentChangeCount >= USERNAME_CHANGE_LIMIT) {
      return NextResponse.json<ChangeUsernameResponseBody>(
        {
          ok: false,
          error: "You've changed your username twice in the last 24 hours. Please wait before changing it again.",
          rateLimited: true,
        },
        { status: 429 },
      );
    }

    await db.$transaction([
      db.user.update({ where: { id: session.userId }, data: { username } }),
      db.usernameChange.create({ data: { userId: session.userId } }),
    ]);

    return NextResponse.json<ChangeUsernameResponseBody>({ ok: true, username });
  } catch (error) {
    console.error("POST /api/account/username failed", error);
    return NextResponse.json<ChangeUsernameResponseBody>(
      { ok: false, error: "Couldn't change your username — the database isn't reachable yet." },
      { status: 500 },
    );
  }
}
