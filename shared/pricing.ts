export type PlanId = "monthly" | "seasonal" | "annual";

export type Plan = {
  id: PlanId;
  name: string;
  price: number;
  currency: "USD" | "CNY";
  /** The monthly price in this plan's currency, used for savings comparisons. */
  monthlyPrice: number;
  /** How many months of service this price covers. */
  months: number;
  /** Short label for the price, e.g. "mo", "3 months", "yr". */
  cadence: string;
};

export const MONTHLY_PRICE = 5.99;

export const PLANS: Plan[] = [
  { id: "monthly", name: "Month", price: 5.99, currency: "USD", monthlyPrice: 5.99, months: 1, cadence: "mo" },
  { id: "seasonal", name: "Season", price: 15.99, currency: "USD", monthlyPrice: 5.99, months: 3, cadence: "3 months" },
  { id: "annual", name: "Year", price: 39.99, currency: "USD", monthlyPrice: 5.99, months: 12, cadence: "yr" },
];

const CHINESE_PLANS: Plan[] = [
  { id: "monthly", name: "Month", price: 39.99, currency: "CNY", monthlyPrice: 39.99, months: 1, cadence: "mo" },
  { id: "seasonal", name: "Season", price: 99.99, currency: "CNY", monthlyPrice: 39.99, months: 3, cadence: "3 months" },
  { id: "annual", name: "Year", price: 269.99, currency: "CNY", monthlyPrice: 39.99, months: 12, cadence: "yr" },
];

export function plansForLocale(locale: "en" | "zh"): Plan[] {
  return locale === "zh" ? CHINESE_PLANS : PLANS;
}

/** What this plan's duration would cost at the plain monthly rate. */
export function baselinePrice(plan: Plan): number {
  return plan.monthlyPrice * plan.months;
}

/** Percent saved vs. paying the monthly rate for the same duration. */
export function discountPercent(plan: Plan): number {
  const baseline = baselinePrice(plan);
  if (baseline <= plan.price) return 0;
  return Math.round((1 - plan.price / baseline) * 100);
}

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function formatPlanPrice(plan: Plan): string {
  return plan.currency === "CNY" ? `¥${plan.price.toFixed(2)}` : formatUsd(plan.price);
}
