import { NextRequest, NextResponse } from "next/server";
import { verifyPassword } from "@/back_end/services/password";
import { getDb } from "@/back_end/services/db";
import { getSession } from "@/back_end/services/session";

export type LoginResponseBody = { ok: true } | { ok: false; error: string };

export async function POST(request: NextRequest) {
  const db = getDb();
  const body = await request.json().catch(() => null);
  const identifier = typeof body?.identifier === "string" ? body.identifier.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!identifier || !password) {
    return NextResponse.json<LoginResponseBody>(
      { ok: false, error: "Enter your email or username and password." },
      { status: 400 },
    );
  }

  try {
    const user = await db.user.findFirst({
      where: { OR: [{ email: identifier.toLowerCase() }, { username: identifier }] },
    });

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return NextResponse.json<LoginResponseBody>(
        { ok: false, error: "Incorrect email/username or password." },
        { status: 401 },
      );
    }

    const session = await getSession();
    session.userId = user.id;
    await session.save();

    return NextResponse.json<LoginResponseBody>({ ok: true });
  } catch (error) {
    console.error("POST /api/auth/login failed", error);
    return NextResponse.json<LoginResponseBody>(
      { ok: false, error: "Couldn't log in — the database isn't reachable yet." },
      { status: 500 },
    );
  }
}
