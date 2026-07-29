import { HTMLAttributes } from "react";
import { cn } from "@/shared/utils";

// component.store-utility-card
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-hairline bg-canvas p-lg font-text text-body text-ink",
        className,
      )}
      {...props}
    />
  );
}
