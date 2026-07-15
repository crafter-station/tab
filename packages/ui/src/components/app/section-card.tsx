import type { PropsWithChildren } from "react";
import { Card } from "../ui/card";
import { cn } from "../../lib/utils";

type SectionCardProps = PropsWithChildren<{
  className?: string;
  variant?: "raised" | "quiet" | "plain";
}>;

export function SectionCard({ className, children, variant = "raised" }: SectionCardProps) {
  return (
    <Card
      className={cn(
        variant === "raised" && "border-border bg-[var(--tab-surface-raised)] text-card-foreground shadow-[var(--tab-shadow-card)]",
        variant === "quiet" && "border-0 bg-[var(--tab-surface-sunken)]/55 text-card-foreground shadow-none",
        variant === "plain" && "border-0 bg-transparent text-card-foreground shadow-none",
        className,
      )}
    >
      {children}
    </Card>
  );
}
