import { Suspense } from "react";
import { AuthRequiredHandler } from "@/front_end/components/AuthRequiredHandler";
import { CapabilityShowcase } from "@/front_end/components/marketing/home/CapabilityShowcase";
import { FinalCta } from "@/front_end/components/marketing/home/FinalCta";
import { Hero } from "@/front_end/components/marketing/home/Hero";
import { HowItWorks } from "@/front_end/components/marketing/home/HowItWorks";
import { SocialProof } from "@/front_end/components/marketing/home/SocialProof";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      <Suspense fallback={null}>
        <AuthRequiredHandler />
      </Suspense>
      <Hero />
      <HowItWorks />
      <CapabilityShowcase />
      <SocialProof />
      <FinalCta />
    </main>
  );
}
