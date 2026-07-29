// Payment provider interface — no real SDK wired up yet.
// PAYMENT_PROVIDER_SECRET_KEY / PAYMENT_PROVIDER_PUBLIC_KEY are reserved for
// whichever provider (Stripe, etc.) gets picked later. This is the shape a
// real provider integration needs to satisfy: create a customer, charge for
// one plan period, and verify inbound webhooks. Purchases are one-time (no
// auto-renewal), so there's deliberately no cancelSubscription here — buying
// more time is just another createSubscription call.

export type PaymentMethod = "card" | "alipay" | "wechat_pay";

export type CreateCustomerParams = {
  userId: string;
  email: string;
};

export type CreateCustomerResult = {
  providerCustomerId: string;
};

export type CreateSubscriptionParams = {
  providerCustomerId: string;
  planId: string;
  paymentMethod: PaymentMethod;
};

export type CreateSubscriptionResult = {
  providerSubscriptionId: string;
  currentPeriodEnd: Date;
};

export interface PaymentProvider {
  createCustomer(params: CreateCustomerParams): Promise<CreateCustomerResult>;
  createSubscription(params: CreateSubscriptionParams): Promise<CreateSubscriptionResult>;
  verifyWebhookSignature(payload: string, signature: string): Promise<boolean>;
}

export const PERIOD_DAYS: Record<string, number> = { monthly: 30, seasonal: 90, annual: 365 };

// TODO: replace with a real provider (Stripe, etc.), reading
// PAYMENT_PROVIDER_SECRET_KEY / PAYMENT_PROVIDER_PUBLIC_KEY from env. Add a
// `/api/billing/webhook` route that calls verifyWebhookSignature and syncs
// failed/disputed one-time charges from the provider into the Subscription
// table (there's no renewal event to sync, since nothing auto-renews).
export const paymentProvider: PaymentProvider = {
  async createCustomer({ userId }) {
    return { providerCustomerId: `mock_cus_${userId}` };
  },
  async createSubscription({ planId }) {
    const periodDays = PERIOD_DAYS[planId] ?? 30;
    return {
      providerSubscriptionId: `mock_sub_${crypto.randomUUID()}`,
      currentPeriodEnd: new Date(Date.now() + periodDays * 24 * 60 * 60 * 1000),
    };
  },
  async verifyWebhookSignature() {
    throw new Error("verifyWebhookSignature is not implemented yet — no real provider wired up");
  },
};
