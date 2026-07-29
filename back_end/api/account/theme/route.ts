import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/back_end/services/db";
import { getSession } from "@/back_end/services/session";
import { isThemePreference, type ThemePreference } from "@/shared/appearance";

export type SaveThemePreferenceResponseBody =
  | { ok: true; themePreference: ThemePreference }
  | { ok: false; error: string };

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json<SaveThemePreferenceResponseBody>(
      { ok: false, error: "You're not logged in." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const themePreference = body?.themePreference;
  if (!isThemePreference(themePreference)) {
    return NextResponse.json<SaveThemePreferenceResponseBody>(
      { ok: false, error: "Choose Light, Dark, or System." },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    await db.user.update({
      where: { id: session.userId },
      data: { themePreference },
    });
    return NextResponse.json<SaveThemePreferenceResponseBody>({ ok: true, themePreference });
  } catch (error) {
    console.error("POST /api/account/theme failed", error);
    return NextResponse.json<SaveThemePreferenceResponseBody>(
      { ok: false, error: "Couldn't save appearance — the database isn't reachable yet." },
      { status: 500 },
    );
  }
}
