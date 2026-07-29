import { InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/shared/utils";

// component.search-input
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-pill border border-black/[0.08] bg-canvas px-5 py-3 font-text text-body text-ink placeholder:text-ink-muted-48 outline-none transition-transform duration-150 ease-out active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-primary-focus",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
