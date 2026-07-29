import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/shared/utils";

// Variants map 1:1 to DESIGN.md's `components.button-*` entries — see
// /docs/design-system.md. DESIGN.md itself documents no hover state (only
// default and active/press), but per explicit product direction the outline
// secondary pill hollows-in to the filled primary look on hover, reverting on
// mouse-leave — primary intentionally does NOT get the reverse hover (only
// the white/outline button animates on hover, per explicit ask). Primary
// still carries a matching transparent 1px border so it stays the same box
// size as secondary wherever the two sit side by side.
type ButtonVariant =
  | "primary"
  | "secondary"
  | "dark-utility"
  | "pearl"
  | "store-hero"
  | "icon";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export const buttonBaseClass =
  "inline-flex items-center justify-center font-text transition-[color,background-color,border-color,transform] duration-150 ease-out active:scale-95 disabled:opacity-40 disabled:pointer-events-none outline-none focus-visible:ring-2 focus-visible:ring-primary-focus focus-visible:ring-offset-2";

export const buttonVariantClasses: Record<ButtonVariant, string> = {
  // component.button-primary — no hover swap (only secondary animates).
  primary:
    "rounded-pill frosted-primary-fill text-on-primary text-body px-[22px] py-[11px]",
  // component.button-secondary-pill — hovers into the primary (filled) look.
  secondary:
    "rounded-pill frosted-primary-hover bg-transparent text-primary text-body border border-primary px-[22px] py-[11px] hover:text-on-primary",
  // component.button-dark-utility
  "dark-utility": "rounded-sm bg-ink text-on-dark text-button-utility px-[15px] py-[8px]",
  // component.button-pearl-capsule
  pearl:
    "rounded-md bg-surface-pearl text-ink-muted-80 text-caption border-[3px] border-divider-soft px-[14px] py-[8px]",
  // component.button-store-hero
  "store-hero": "rounded-pill frosted-primary-fill text-on-primary text-button-large px-[28px] py-[14px]",
  // component.button-icon-circular
  icon: "rounded-full bg-surface-chip-translucent/64 text-ink h-11 w-11",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", className, ...props }, ref) => (
    <button ref={ref} className={cn(buttonBaseClass, buttonVariantClasses[variant], className)} {...props} />
  ),
);
Button.displayName = "Button";
