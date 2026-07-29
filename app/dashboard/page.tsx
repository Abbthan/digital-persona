import { DashboardPageClient } from "@/front_end/components/dashboard/DashboardPageClient";

// Keep this route static. Authentication and persona data are fetched by the
// client after hydration, so a dashboard visit never performs database work
// while Cloudflare is rendering the page itself.
export default function DashboardPage() {
  return <DashboardPageClient />;
}
