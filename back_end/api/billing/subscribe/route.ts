import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/back_end/services/db";
import { hasPaidAccess } from "@/back_end/services/limits";
import { paymentProvider, PERIOD_DAYS, type PaymentMethod } from "@/back_end/services/payment";
import { PLANS, type PlanId } from "@/shared/pricing";
import { getSession } from "@/back_end/services/session";

export type SubscribeRequestBody = {
  planId: PlanId;
  paymentMethod: PaymentMethod;
};

export type SubscribeResponseBody =
  | { ok: true; plan: PlanId; status: "active"; currentPeriodEnd: string }
  | { ok: false; error: string };

export async function POST(request: NextRequest) {
  const db = getDb();
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json<SubscribeResponseBody>(
      { ok: false, error: "You're not logged in." },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => null)) as Partial<SubscribeRequestBody> | null;
  const plan = PLANS.find((candidate) => candidate.id === body?.planId);
  if (!plan || !body?.paymentMethod) {
    return NextResponse.json<SubscribeResponseBody>(
      { ok: false, error: "Missing planId or paymentMethod." },
      { status: 400 },
    );
  }

  try {
    const user = await db.user.findUnique({ where: { id: session.userId } });
    if (!user) {
      return NextResponse.json<SubscribeResponseBody>(
        { ok: false, error: "No account found for this session." },
        { status: 404 },
      );
    }

    const customer = await paymentProvider.createCustomer({ userId: user.id, email: user.email });
    // This is a one-time purchase, not a recurring subscription — no
    // auto-renewal, nothing to cancel. The mock provider's own
    // currentPeriodEnd always counts from "now", so if there's unexpired
    // time left on the clock already, this purchase stacks on top of it
    // (extending the expiry date) instead of discarding the remainder.
    await paymentProvider.createSubscription({
      providerCustomerId: customer.providerCustomerId,
      planId: plan.id,
      paymentMethod: body.paymentMethod,
    });

    const now = new Date();
    const extendFrom = hasPaidAccess(user.subscriptionStatus, user.subscriptionRenewsAt)
      ? user.subscriptionRenewsAt!
      : now;
    const periodDays = PERIOD_DAYS[plan.id] ?? 30;
    const currentPeriodEnd = new Date(extendFrom.getTime() + periodDays * 24 * 60 * 60 * 1000);

    await db.subscription.create({
      data: {
        userId: user.id,
        plan: plan.id,
        status: "active",
        currentPeriodEnd,
        provider: "mock",
        providerCustomerId: customer.providerCustomerId,
      },
    });

    await db.user.update({
      where: { id: user.id },
      data: {
        subscriptionPlan: plan.id,
        subscriptionStatus: "active",
        subscriptionRenewsAt: currentPeriodEnd,
      },
    });

    return NextResponse.json<SubscribeResponseBody>({
      ok: true,
      plan: plan.id,
      status: "active",
      currentPeriodEnd: currentPeriodEnd.toISOString(),
    });
  } catch (error) {
    console.error("POST /api/billing/subscribe failed", error);
    return NextResponse.json<SubscribeResponseBody>(
      { ok: false, error: "Couldn't complete checkout — the database isn't reachable yet." },
      { status: 500 },
    );
  }
}
