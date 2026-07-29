import { NextResponse } from "next/server";
import { getDb } from "@/back_end/services/db";

export async function GET() {
  try {
    const db = getDb();
    const [registeredUsers, metrics] = await Promise.all([
      db.user.count(),
      db.platformMetric.findUnique({ where: { id: "global" } }),
    ]);
    return NextResponse.json(
      {
        registeredUsers,
        personasCreated: metrics?.personasCreated ?? 0,
        messagesExchanged: metrics?.messagesExchanged ?? 0,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    console.error("GET /api/public/stats failed", error);
    return NextResponse.json({ error: "Couldn't load registration statistics." }, { status: 503 });
  }
}
