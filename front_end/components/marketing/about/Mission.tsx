import { Parallax } from "@/front_end/components/marketing/Parallax";
import { PlaceholderArt } from "@/front_end/components/marketing/PlaceholderArt";
import { Section } from "@/front_end/components/marketing/Section";

export function Mission() {
  return (
    <Section tone="canvas" clearDock>
      <p className="font-text text-caption-strong text-ink-muted-48">Our mission</p>
      <h1 className="mt-xs font-display text-display-lg text-ink">
        Nobody should lose the chance to say one more thing
      </h1>
      <p className="mt-md w-full max-w-[36rem] font-text text-body text-ink-muted-80">
        ECHO 回响 exists so a voice, a face, and a way of speaking don&apos;t have to disappear
        completely. We help people build a persona from what someone left behind — photos,
        messages, recordings — and keep a conversation open.
      </p>

      <Parallax speed={0.15} className="mt-xxl w-full max-w-[40rem]">
        <PlaceholderArt variant="warm" />
      </Parallax>
    </Section>
  );
}
