import Image from "next/image";
import { PlaceholderArt } from "@/front_end/components/marketing/PlaceholderArt";
import { Section } from "@/front_end/components/marketing/Section";

const team = [
  {
    name: "Ethan Ma",
    role: "Founder & CEO",
    contact: "ethanma@echodigitalpersona.com",
    image: "/images/ethan-ma-founder.png",
  },
  { name: "Placeholder name", role: "Head of Engineering" },
  { name: "Placeholder name", role: "Head of Trust & Safety" },
];

export function Team() {
  return (
    <Section tone="canvas">
      <p className="font-text text-caption-strong text-ink-muted-48">Our team</p>
      <h2 className="mt-xs font-display text-display-lg text-ink">The people building ECHO</h2>

      <div className="mt-xxl grid w-full grid-cols-1 gap-lg text-left sm:grid-cols-3">
        {team.map((member) => (
          <div key={member.role} className="flex flex-col gap-sm">
            {member.image ? (
              <div className="relative aspect-square overflow-hidden rounded-lg bg-surface-pearl">
                <Image
                  src={member.image}
                  alt={`Portrait of ${member.name}`}
                  fill
                  sizes="(min-width: 640px) 33vw, 100vw"
                  className="object-cover object-center"
                />
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
