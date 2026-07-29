import { Card } from "@/front_end/components/ui";
import { Section } from "@/front_end/components/marketing/Section";

const inputs = [
  { label: "Photos" },
  { label: "Chat history" },
  { label: "Documents" },
  { label: "Video" },
  { label: "Audio" },
  { label: "Live facial scan" },
];

const tiers = [
  {
    name: "Free",
    description: "Text conversations with your persona, whenever you want to talk.",
  },
  {
    name: "Subscriber",
    description: "Everything in Free, plus real-time voice and video conversation.",
  },
];

export function CapabilityShowcase() {
  return (
    <Section tone="canvas">
      <p className="font-text text-caption-strong text-ink-muted-48">What ECHO learns from</p>
      <h2 className="mt-xs font-display text-display-lg text-ink">Every kind of memory</h2>

      <div className="mt-xxl grid w-full grid-cols-2 gap-sm sm:grid-cols-3">
        {inputs.map((input) => (
          <div
            key={input.label}
            className="rounded-pill border border-hairline bg-canvas px-lg py-sm font-text text-body text-ink"
          >
            {input.label}
          </div>
        ))}
      </div>

      <div className="mt-xxl grid w-full grid-cols-1 gap-lg text-left sm:grid-cols-2">
        {tiers.map((tier) => (
          <Card key={tier.name} className="flex flex-col gap-xs">
            <p className="font-text text-body-strong text-ink">{tier.name}</p>
            <p className="font-text text-body text-ink-muted-80">{tier.description}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}
