import Image from "next/image";
import { PlaceholderArt } from "@/front_end/components/marketing/PlaceholderArt";
import { Section } from "@/front_end/components/marketing/Section";

const members = [
  {
    name: "Ethan Ma",
    role: "Co-Founder",
    contact: "ethanma@echodigitalpersona.com",
    image: "/images/ethan-ma-founder.png",
  },
  { name: "Coming soon", role: "Co-Founder" },
];

export function NonProfit() {
  return (
    <Section tone="canvas">
      <p className="font-text text-caption-strong text-ink-muted-48">Meet our Non-Profit</p>
      <h2 className="mt-xs font-display text-display-lg text-ink">ECHO Companionship for Hospice Organisations</h2>
      <div className="mt-xxl grid w-full grid-cols-1 gap-lg text-left sm:grid-cols-2">
        {members.map((member) => (
          <div key={`${member.name}-${member.role}`} className="flex flex-col gap-sm">
            {member.image ? (
              <div className="relative aspect-square overflow-hidden rounded-lg bg-surface-pearl">
                <Image src={member.image} alt={`Portrait of ${member.name}`} fill sizes="(min-width: 640px) 50vw, 100vw" className="object-cover object-center" />
              </div>
            ) : (
              <PlaceholderArt variant="primary" className="aspect-square" />
            )}
            <p className="font-text text-body-strong text-ink">{member.name}</p>
            <p className="font-text text-caption text-ink-muted-80">{member.role}</p>
            {member.contact ? <a href={`mailto:${member.contact}`} className="font-text text-caption text-primary transition-opacity hover:opacity-75">{member.contact}</a> : null}
          </div>
        ))}
      </div>
    </Section>
  );
}
