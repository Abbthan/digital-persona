import { HTMLAttributes } from "react";
import { cn } from "@/shared/utils";

type PlaceholderArtProps = HTMLAttributes<HTMLDivElement> & {
  variant?: "primary" | "warm" | "dark";
};

// Abstract gradient/blur placeholder for all marketing imagery. Deliberately
// non-figurative (no stock photos or illustrations of people) — this product
// creates AI personas from real people's likenesses, so no placeholder should
// ever imply it's showing an actual person until real, consented product
// screenshots exist.
const variantClass: Record<NonNullable<PlaceholderArtProps["variant"]>, string> = {
  primary: "bg-canvas-parchment",
  warm: "bg-surface-pearl",
  dark: "bg-surface-tile-2",
};

const blobClass: Record<NonNullable<PlaceholderArtProps["variant"]>, [string, string]> = {
  primary: ["bg-primary/40", "bg-primary-on-dark/30"],
  warm: ["bg-primary/25", "bg-ink-muted-48/20"],
  dark: ["bg-primary-on-dark/35", "bg-primary/25"],
};

export function PlaceholderArt({ variant = "primary", className, ...props }: PlaceholderArtProps) {
  const [blobA, blobB] = blobClass[variant];

  return (
    <div
      className={cn(
        "relative aspect-video w-full overflow-hidden rounded-lg",
        variantClass[variant],
        className,
      )}
      {...props}
    >
      <div className={cn("absolute -left-1/4 -top-1/4 h-3/4 w-3/4 rounded-full blur-3xl", blobA)} />
      <div className={cn("absolute -bottom-1/4 -right-1/4 h-3/4 w-3/4 rounded-full blur-3xl", blobB)} />
    </div>
  );
}
