import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/back_end/services/db";
import { getSession } from "@/back_end/services/session";
import { isSupportedLocale, type SupportedLocale } from "@/shared/i18n";

export type SaveLanguagePreferenceResponseBody =
  | { ok: true; languagePreference: SupportedLocale }
  | { ok: false; error: string };

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json<SaveLanguagePreferenceResponseBody>(
      { ok: false, error: "You're not logged in." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const languagePreference = body?.languagePreference;
  if (!isSupportedLocale(languagePreference)) {
    return NextResponse.json<SaveLanguagePreferenceResponseBody>(
      { ok: false, error: "Choose English or Chinese." },
      { status: 400 },
    );
  }

  try {
    await getDb().user.update({
      where: { id: session.userId },
      data: { languagePreference },
    });
    return NextResponse.json<SaveLanguagePreferenceResponseBody>({ ok: true, languagePreference });
  } catch (error) {
    console.error("POST /api/account/language failed", error);
    return NextResponse.json<SaveLanguagePreferenceResponseBody>(
      { ok: false, error: "Couldn't save language — the database isn't reachable yet." },
      { status: 500 },
    );
  }
}
