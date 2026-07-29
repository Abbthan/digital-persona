import { Section } from "@/front_end/components/marketing/Section";
import { LiveStats } from "./RegisteredUsers";

const testimonials = [
  {
    quote: "Talking to her persona feels like she's still here to ask for advice.",
    name: "Placeholder user",
  },
  {
    quote: "The voice conversations are the closest thing to actually calling him.",
    name: "Placeholder user",
  },
  {
    quote: "I uploaded ten years of messages and it just... got him.",
    name: "Placeholder user",
  },
];

export function SocialProof() {
  return (
    <Section tone="dark">
      <p className="font-text text-caption-strong text-primary-on-dark">Placeholder content</p>
      <h2 className="mt-xs font-display text-display-lg text-on-dark">Loved by early users</h2>

      <div className="mt-xxl grid w-full grid-cols-1 gap-lg sm:grid-cols-3">
        <LiveStats />
      </div>

      <div className="mt-xxl grid w-full grid-cols-1 gap-lg text-left sm:grid-cols-3">
        {testimonials.map((testimonial) => (
          <div key={testimonial.quote} className="rounded-lg border border-white/10 p-lg">
            <p className="font-text text-body text-on-dark">&ldquo;{testimonial.quote}&rdquo;</p>
            <p className="mt-sm font-text text-caption text-body-muted">{testimonial.name}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
