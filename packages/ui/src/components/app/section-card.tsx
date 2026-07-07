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
        "border-[var(--tabb-glass-border)] bg-[linear-gradient(145deg,var(--tabb-glass-bg),color-mix(in_srgb,var(--card)_74%,transparent))] text-card-foreground shadow-[var(--tabb-glass-shadow)] backdrop-blur-2xl",
        className,
      )}
    >
      {children}
    </Card>
  );
}
