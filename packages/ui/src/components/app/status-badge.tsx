import type { PropsWithChildren } from "react";
import { Badge } from "../ui/badge";
import { cn } from "../../lib/utils";

export type StatusBadgeTone = "ok" | "warning" | "muted";

type StatusBadgeProps = PropsWithChildren<{
  tone?: StatusBadgeTone;
  className?: string;
}>;

export function StatusBadge({ tone = "muted", className, children }: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        tone === "ok" && "border-[color-mix(in_srgb,var(--tab-success)_24%,transparent)] bg-[var(--tab-success-tint)] text-[var(--tab-success)]",
        tone === "warning" && "border-[color-mix(in_srgb,var(--warning)_28%,transparent)] bg-[var(--tab-warning-tint)] text-[var(--warning)]",
        tone === "muted" && "bg-muted text-muted-foreground",
        className,
      )}
    >
      {children}
    </Badge>
  );
}
