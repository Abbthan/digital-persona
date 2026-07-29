import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/back_end/services/auth";
import { getDb } from "@/back_end/services/db";
import { sendFaqQuestionEmail } from "@/back_end/services/email";

type FaqQuestionResponse = { ok: true } | { ok: false; error: string };

export async function POST(request: NextRequest) {
  const user = await getCurrentUser().catch(() => null);
  if (!user || !user.emailVerified) {
    return NextResponse.json<FaqQuestionResponse>({ ok: false, error: "Please log in or register before sending a question." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!name || name.length > 50) {
    return NextResponse.json<FaqQuestionResponse>({ ok: false, error: "Enter a name of up to 50 characters." }, { status: 400 });
  }
  if (!question || question.length > 500) {
    return NextResponse.json<FaqQuestionResponse>({ ok: false, error: "Enter a question of up to 500 characters." }, { status: 400 });
  }

  try {
    const db = getDb();
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const reservationId = await db.$transaction(async (tx) => {
      // Taking a row lock on the account serializes simultaneous submissions
      // from different tabs/devices, so they cannot both pass the count check.
      await tx.user.update({
        where: { id: user.id },
        data: { themePreference: user.themePreference },
        select: { id: true },
      });
      const sentInWindow = await tx.faqQuestion.count({
        where: { userId: user.id, createdAt: { gte: windowStart } },
      });
      if (sentInWindow >= 2) return null;
      const reservation = await tx.faqQuestion.create({ data: { userId: user.id }, select: { id: true } });
      return reservation.id;
    });
    if (!reservationId) {
      return NextResponse.json<FaqQuestionResponse>(
        { ok: false, error: "You can send up to 2 questions every 24 hours. Please try again later." },
        { status: 429 },
      );
    }
    try {
      await sendFaqQuestionEmail({
        accountName: user.username,
        accountEmail: user.email,
        submittedName: name,
        question,
      });
    } catch (error) {
      // A delivery failure must not consume one of the account's two slots.
      await db.faqQuestion.delete({ where: { id: reservationId } }).catch(() => null);
      throw error;
    }
    return NextResponse.json<FaqQuestionResponse>({ ok: true });
  } catch (error) {
    console.error("POST /api/faq/questions failed", error);
    return NextResponse.json<FaqQuestionResponse>({ ok: false, error: "We couldn't send your question. Please try again shortly." }, { status: 500 });
  }
}
