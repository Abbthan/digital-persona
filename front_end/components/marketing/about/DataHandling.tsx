import { Section } from "@/front_end/components/marketing/Section";

const principles = [
  {
    title: "You control what's uploaded",
    body: "Every photo, recording, and message is added deliberately, asset by asset, and can be removed at any time.",
  },
  {
    title: "Likenesses stay private by default",
    body: "Personas are visible only to the account that created them — never public, never used to train models for other users.",
  },
  {
    title: "Deletion means deletion",
    body: "Removing a persona removes its underlying media and derived data, not just the chat interface.",
  },
  {
    title: "Sensitive by design",
    body: "Faces, voices, and video are handled as sensitive personal data throughout the product, not just in the fine print.",
  },
];

export function DataHandling() {
  return (
    <Section tone="dark">
      <p className="font-text text-caption-strong text-primary-on-dark">Handled responsibly</p>
      <h2 className="mt-xs font-display text-display-lg text-on-dark">
        A likeness deserves real care
      </h2>
      <p className="mt-md w-full max-w-[36rem] font-text text-body text-body-muted">
        Photos, voice, and video are about as personal as data gets. Here&apos;s how we think
        about handling it.
      </p>

      <div className="mt-xxl grid w-full grid-cols-1 gap-lg text-left sm:grid-cols-2">
        {principles.map((principle) => (
          <div key={principle.title} className="rounded-lg border border-white/10 p-lg">
            <p className="font-text text-body-strong text-on-dark">{principle.title}</p>
            <p className="mt-xs font-text text-body text-body-muted">{principle.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
