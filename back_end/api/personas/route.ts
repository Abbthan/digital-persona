import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/back_end/services/auth";
import { getDb } from "@/back_end/services/db";
import { personaLimitFor } from "@/back_end/services/limits";
import { maskInappropriateLanguage } from "@/back_end/services/moderation";
import { incrementPlatformMetrics } from "@/back_end/services/metrics";

export type CreatePersonaResponseBody =
  | { ok: true; persona: { id: string; name: string } }
  | { ok: false; error: string };

export type ListPersonasResponseBody =
  | { ok: true; personas: { id: string; name: string; status: string; videoReady: boolean; trainingStartedAt: string | null }[] }
  | { ok: false; error: string };

export async function GET() {
  const db = getDb();
  const user = await getCurrentUser().catch(() => null);
  if (!user || !user.emailVerified) {
    return NextResponse.json<ListPersonasResponseBody>(
      { ok: false, error: "You're not logged in." },
      { status: 401 },
    );
  }

  try {
    const personas = await db.persona.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, status: true, liveAvatarId: true, trainingStartedAt: true },
    });
    return NextResponse.json<ListPersonasResponseBody>({
      ok: true,
      personas: personas.map(({ liveAvatarId, trainingStartedAt, ...persona }) => ({
        ...persona,
        videoReady: Boolean(liveAvatarId),
        trainingStartedAt: trainingStartedAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    console.error("GET /api/personas failed", error);
    return NextResponse.json<ListPersonasResponseBody>(
      { ok: false, error: "Couldn't load personas — the database isn't reachable yet." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const db = getDb();
  const user = await getCurrentUser().catch(() => null);
  if (!user || !user.emailVerified) {
    return NextResponse.json<CreatePersonaResponseBody>(
      { ok: false, error: "You're not logged in." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? maskInappropriateLanguage(body.name.trim()) : "";

  if (!name || name.length < 2 || name.length > 40) {
    return NextResponse.json<CreatePersonaResponseBody>(
      { ok: false, error: "Enter a name between 2 and 40 characters." },
      { status: 400 },
    );
  }

  // Cartoon has no model behind it yet (only MuseTalk/Realistic is wired
  // up) — reject rather than silently accepting a style nothing downstream
  // can honor. The wizard's own slider already blocks this in the UI.
  if (body?.avatarStyle === "cartoon") {
    return NextResponse.json<CreatePersonaResponseBody>(
      { ok: false, error: "Cartoon style isn't available yet — only Realistic is supported right now." },
      { status: 400 },
    );
  }
  const avatarStyle = "realistic";

  try {
    // Client pre-checks the limit before even opening this flow, but that's
    // just UX — this is the check that actually matters.
    const existingCount = await db.persona.count({ where: { userId: user.id } });
    const limit = personaLimitFor(user.subscriptionStatus, user.subscriptionRenewsAt);
    if (existingCount >= limit) {
      return NextResponse.json<CreatePersonaResponseBody>(
        {
          ok: false,
          error: `You've reached your plan's limit of ${limit} persona${limit === 1 ? "" : "s"}.`,
        },
        { status: 403 },
      );
    }

    const persona = await db.persona.create({
      data: { userId: user.id, name, status: "draft", avatarStyle },
      select: { id: true, name: true },
    });

    console.info("[persona-create] persisted", { personaId: persona.id, userId: user.id, avatarStyle });

    await incrementPlatformMetrics({ personasCreated: 1 }).catch((metricError) => {
      console.error("Persona metric increment failed", metricError);
    });
    return NextResponse.json<CreatePersonaResponseBody>({ ok: true, persona });
  } catch (error) {
    console.error("POST /api/personas failed", error);
    return NextResponse.json<CreatePersonaResponseBody>(
      { ok: false, error: "Couldn't create the persona — the database isn't reachable yet." },
      { status: 500 },
    );
  }
}
