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
        tone === "ok" && "border-[color-mix(in_srgb,var(--tabb-success)_24%,transparent)] bg-[var(--tabb-success-tint)] text-[var(--tabb-success)]",
        tone === "warning" && "border-[color-mix(in_srgb,var(--tabb-signal)_26%,transparent)] bg-[var(--tabb-signal-tint)] text-[var(--tabb-signal)]",
        tone === "muted" && "bg-muted text-muted-foreground",
        className,
      )}
    >
      {children}
    </Badge>
  );
}
