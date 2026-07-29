import { NextResponse } from "next/server";
import { getSession } from "@/back_end/services/session";

export async function POST() {
  const session = await getSession();
  session.destroy();
  return NextResponse.json({ ok: true });
}
