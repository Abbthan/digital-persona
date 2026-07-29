"use client";

import { FormEvent, useState } from "react";
import { Button, Input, Modal } from "@/front_end/components/ui";
import { useAuth } from "@/front_end/state/auth-context";
import { useLocale } from "@/front_end/state/locale-context";
import { formatPlanPrice, plansForLocale, type Plan } from "@/shared/pricing";
import type { PaymentMethod } from "@/back_end/services/payment";
import type { SubscribeResponseBody } from "@/back_end/api/billing/subscribe/route";

type Step = "method" | "details" | "confirm" | "success" | "error";

type CheckoutModalProps = {
  plan: Plan | null;
  onClose: () => void;
};

const methodLabels: Record<PaymentMethod, string> = {
  card: "Credit or debit card",
  alipay: "AliPay",
  wechat_pay: "WeChat Pay",
};

export function CheckoutModal({ plan, onClose }: CheckoutModalProps) {
  const { user, refresh } = useAuth();
  const { locale } = useLocale();
  const [step, setStep] = useState<Step>("method");
  const [method, setMethod] = useState<PaymentMethod>("card");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setStep("method");
    setMethod("card");
    setErrorMessage(null);
    setSubmitting(false);
  }

  function handleClose() {
    onClose();
    // Let the close animation-less unmount happen before resetting state.
    setTimeout(reset, 0);
  }

  async function handleConfirm() {
    if (!plan || !user) return;
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: plan.id, paymentMethod: method }),
      });
      const result = (await response.json()) as SubscribeResponseBody;

      if (!result.ok) {
        setErrorMessage(result.error);
        setStep("error");
        return;
      }

      await refresh();
      setStep("success");
    } catch {
      setErrorMessage("Couldn't reach the server. Check your connection and try again.");
      setStep("error");
    } finally {
      setSubmitting(false);
    }
  }

  function handleDetailsSubmit(event: FormEvent) {
    event.preventDefault();
    setStep("confirm");
  }

  if (!plan) return null;
  const localizedPlan = plansForLocale(locale).find((candidate) => candidate.id === plan.id) ?? plan;

  return (
    <Modal open={plan !== null} onClose={handleClose}>
      <h2 className="font-display text-tagline text-ink">Purchase {localizedPlan.name}</h2>
      <p className="mt-xxs font-text text-caption text-ink-muted-80">
        {formatPlanPrice(localizedPlan)} / {localizedPlan.cadence}
      </p>

      {step === "method" && (
        <div className="mt-lg flex flex-col gap-sm">
          {(Object.keys(methodLabels) as PaymentMethod[]).map((option) => (
            <button
              key={option}
              onClick={() => setMethod(option)}
              className={`rounded-md border px-lg py-sm text-left font-text text-body transition-transform duration-150 ease-out active:scale-[0.99] ${
                method === option ? "border-primary-focus text-ink" : "border-hairline text-ink-muted-80"
              }`}
            >
              {methodLabels[option]}
            </button>
          ))}
          <Button variant="primary" className="mt-xs" onClick={() => setStep("details")}>
            Continue
          </Button>
        </div>
      )}

      {step === "details" && method === "card" && (
        <form onSubmit={handleDetailsSubmit} className="mt-lg flex flex-col gap-sm">
          <Input placeholder="Card number" inputMode="numeric" required />
          <div className="flex gap-sm">
            <Input placeholder="MM / YY" required className="w-1/2" />
            <Input placeholder="CVC" inputMode="numeric" required className="w-1/2" />
          </div>
          <Input placeholder="Name on card" required />
          <Input placeholder="Billing address" required />
          <Button type="submit" variant="primary" className="mt-xs">
            Review order
          </Button>
        </form>
      )}

      {step === "details" && method !== "card" && (
        <div className="mt-lg flex flex-col items-center gap-sm text-center">
          <div className="flex h-40 w-40 items-center justify-center rounded-lg border border-hairline bg-canvas-parchment font-text text-caption text-ink-muted-48">
            QR code placeholder
          </div>
          <p className="font-text text-caption text-ink-muted-80">
            Scan with {methodLabels[method]} to pay. (No real payment is processed in this demo.)
          </p>
          <Button variant="primary" onClick={() => setStep("confirm")}>
            I&apos;ve completed payment
          </Button>
        </div>
      )}

      {step === "confirm" && (
        <div className="mt-lg flex flex-col gap-sm">
          <div className="rounded-md border border-hairline p-lg font-text text-body text-ink">
            <p>
              Plan: <span className="text-body-strong">{localizedPlan.name}</span>
            </p>
            <p className="mt-xxs">
              Price: <span className="text-body-strong">{formatPlanPrice(localizedPlan)} / {localizedPlan.cadence}</span>
            </p>
            <p className="mt-xxs">
              Payment method: <span className="text-body-strong">{methodLabels[method]}</span>
            </p>
          </div>
          <p className="font-text text-fine-print text-ink-muted-48">
            One-time purchase, not a recurring subscription — this won&apos;t auto-renew or charge you again.
            If you already have time remaining, this adds to it.
          </p>
          <Button variant="primary" onClick={handleConfirm} disabled={submitting}>
            {submitting ? "Confirming…" : "Confirm purchase"}
          </Button>
        </div>
      )}

      {step === "success" && (
        <div className="mt-lg flex flex-col gap-sm">
          <p className="font-text text-body text-ink">
            You&apos;ve purchased {localizedPlan.name}. Welcome aboard.
          </p>
          <Button variant="primary" onClick={handleClose}>
            Done
          </Button>
        </div>
      )}

      {step === "error" && (
        <div className="mt-lg flex flex-col gap-sm">
          <p className="font-text text-body text-red-500">{errorMessage}</p>
          <Button variant="secondary" onClick={() => setStep("confirm")}>
            Try again
          </Button>
        </div>
      )}
    </Modal>
  );
}
