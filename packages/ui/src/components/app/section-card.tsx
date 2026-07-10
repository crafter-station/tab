import type { PropsWithChildren } from "react";
import { Card } from "../ui/card";
import { cn } from "../../lib/utils";

type SectionCardProps = PropsWithChildren<{
  className?: string;
}>;

export function SectionCard({ className, children }: SectionCardProps) {
  return (
    <Card
      className={cn(
        "border-[var(--tab-glass-border)] bg-[var(--tab-surface-raised)] text-card-foreground shadow-[var(--tab-shadow-window)]",
        className,
      )}
    >
      {children}
    </Card>
  );
}
