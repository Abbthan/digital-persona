"use client";

import { Button, Card } from "@/front_end/components/ui";
import { useAuth } from "@/front_end/state/auth-context";
import { useLocale } from "@/front_end/state/locale-context";
import { useModalController } from "@/front_end/state/modal-context";
import { baselinePrice, discountPercent, formatPlanPrice, plansForLocale, type Plan } from "@/shared/pricing";

type PricingCardsProps = {
  onSubscribe: (plan: Plan) => void;
};

export function PricingCards({ onSubscribe }: PricingCardsProps) {
  const { isAuthenticated, user } = useAuth();
  const { locale } = useLocale();
  const { openModal } = useModalController();
  const plans = plansForLocale(locale);

  function handlePurchaseClick(plan: Plan) {
    // Covers both "logged out" and "logged in but unverified" — AuthModal
    // shows the verify screen automatically for an unverified session
    // regardless of which tab it's opened with.
    if (!isAuthenticated || !user?.emailVerified) {
      openModal("auth", { authTab: "login" });
      return;
    }
    onSubscribe(plan);
  }

  return (
    <div className="grid w-full grid-cols-1 gap-lg sm:grid-cols-3">
      {plans.map((plan) => {
        const discount = discountPercent(plan);
        const baseline = baselinePrice(plan);
        return (
          <Card key={plan.id} className="flex flex-col items-start gap-sm text-left">
            {/* flex-1 keeps every purchase button aligned to the bottom of
                its card, regardless of whether a savings badge is shown. */}
            <div className="flex w-full flex-1 flex-col items-start gap-sm">
              <p className="font-text text-body-strong text-ink">{plan.name}</p>

              <div className="flex items-baseline gap-xs">
                <p className="font-display text-display-md text-ink">{formatPlanPrice(plan)}</p>
                <p className="font-text text-caption text-ink-muted-48">/ {plan.cadence}</p>
              </div>

              {discount > 0 && (
                <div className="flex items-center gap-xs">
                  <p className="font-text text-caption text-ink-muted-48 line-through">
                    {plan.currency === "CNY" ? `¥${baseline.toFixed(2)}` : `$${baseline.toFixed(2)}`}
                  </p>
                  <p className="rounded-pill bg-canvas-parchment px-xs py-[2px] font-text text-caption-strong text-primary">
                    {locale === "zh" ? `优惠 ${discount}%` : `Save ${discount}%`}
                  </p>
                </div>
              )}
            </div>

            {/* Purchasing is always available, even on your current plan —
                buying more time accumulates onto the existing expiry date
                rather than being blocked, since there's no recurring
                subscription to "switch" or "manage" here. */}
            <Button variant="secondary" className="mt-sm w-full" onClick={() => handlePurchaseClick(plan)}>
              Purchase
            </Button>
          </Card>
        );
      })}
    </div>
  );
}
