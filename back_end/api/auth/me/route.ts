import { NextResponse } from "next/server";
import { getCurrentUser } from "@/back_end/services/auth";

export async function GET() {
  try {
    const user = await getCurrentUser({ refreshSession: true });
    return NextResponse.json({ user }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("GET /api/auth/me failed", error);
    return NextResponse.json({ user: null }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
