import type { PropsWithChildren } from "react";
import { cn } from "../../lib/utils";
import { StatusBadge } from "./status-badge";

export type PermissionState = "granted" | "pending" | "manual";

type PermissionCardProps = PropsWithChildren<{
  title: string;
  description: string;
  status: string;
  state: PermissionState;
  className?: string;
}>;

export function PermissionCard({ title, description, status, state, className, children }: PermissionCardProps) {
  const tone = state === "granted" ? "success" : state === "pending" ? "warning" : "neutral";

  return (
    <article
      className={cn(
        "grid gap-3 border-b border-border py-4 last:border-b-0",
        state === "granted" && "border-[var(--tab-success-border)]",
        state === "pending" && "border-[var(--tab-warning-border)]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-1">
          <h2 className="text-base font-semibold leading-snug">{title}</h2>
          <p className="max-w-[65ch] text-sm leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <StatusBadge tone={tone}>{status}</StatusBadge>
      </div>
      {children ? <div className="max-w-[65ch] text-sm leading-relaxed text-muted-foreground">{children}</div> : null}
    </article>
  );
}
