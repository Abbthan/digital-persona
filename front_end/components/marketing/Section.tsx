import { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/shared/utils";

type SectionProps = HTMLAttributes<HTMLElement> & {
  tone?: "canvas" | "parchment" | "dark";
  /** Set on the first section of a page — the floating Dock is `fixed`, so it
   * sits on top of normal document flow (currently ~86px tall including its
   * top offset) and the default py-section top padding (80px) isn't quite
   * enough to clear it. Swaps in more top padding instead of stacking an
   * extra pt-* utility alongside py-section, which would fight over the same
   * padding-top property (see the Tailwind spacing-collision note in
   * docs/design-system.md). */
  clearDock?: boolean;
  /** Full-bleed decorative layer, e.g. a gradient — renders behind the
   * constrained content column, spanning the whole section rather than
   * being capped at max-w-[64rem] like children are. */
  background?: ReactNode;
};

// component.product-tile-light / product-tile-parchment / product-tile-dark —
// full-bleed, edge-to-edge, alternating light/dark tiles are how DESIGN.md
// creates section rhythm (the color change is the divider, not a border or
// shadow). Each is full-viewport-height per Phase 2's spec.
const toneClass: Record<NonNullable<SectionProps["tone"]>, string> = {
  canvas: "bg-canvas text-ink",
  parchment: "bg-canvas-parchment text-ink",
  dark: "bg-surface-tile-1 text-on-dark",
};

export function Section({ tone = "canvas", clearDock = false, background, className, children, ...props }: SectionProps) {
  return (
    <section
      className={cn(
        "relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden px-lg pb-section text-center",
        clearDock ? "pt-32" : "pt-section",
        toneClass[tone],
        className,
      )}
      {...props}
    >
      {background}
      <div className="relative flex w-full max-w-[64rem] flex-col items-center">{children}</div>
    </section>
  );
}
