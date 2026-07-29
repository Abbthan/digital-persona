import { ClosingCta } from "@/front_end/components/marketing/about/ClosingCta";
import { DataHandling } from "@/front_end/components/marketing/about/DataHandling";
import { Mission } from "@/front_end/components/marketing/about/Mission";
import { Team } from "@/front_end/components/marketing/about/Team";
import { NonProfit } from "@/front_end/components/marketing/about/NonProfit";

export default function AboutPage() {
  return (
    <main className="flex flex-1 flex-col">
      <Mission />
      <DataHandling />
      <Team />
      <NonProfit />
      <ClosingCta />
    </main>
  );
}
