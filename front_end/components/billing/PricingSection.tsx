"use client";

import { useState } from "react";
import { AcceptedPaymentMethods } from "@/front_end/components/billing/AcceptedPaymentMethods";
import { CheckoutModal } from "@/front_end/components/billing/CheckoutModal";
import { PricingCards } from "@/front_end/components/billing/PricingCards";
import type { Plan } from "@/shared/pricing";

export function PricingSection() {
  const [checkoutPlan, setCheckoutPlan] = useState<Plan | null>(null);

  return (
    <div className="flex w-full flex-col items-center gap-xxl">
      <PricingCards onSubscribe={setCheckoutPlan} />
      <AcceptedPaymentMethods />
      <CheckoutModal plan={checkoutPlan} onClose={() => setCheckoutPlan(null)} />
    </div>
  );
}
