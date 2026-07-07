import type { PropsWithChildren } from "react";

type StatusBadgeTone = "ok" | "warning" | "muted";

type StatusBadgeProps = PropsWithChildren<{
  tone?: StatusBadgeTone;
}>;

export function StatusBadge({ tone = "muted", children }: StatusBadgeProps) {
  return <span className={`status-badge status-badge--${tone}`}>{children}</span>;
}
