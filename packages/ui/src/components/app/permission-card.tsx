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
  const tone = state === "granted" ? "ok" : state === "pending" ? "warning" : "muted";

  return (
    <article
      className={cn(
        "grid gap-3 rounded-[18px] border bg-muted/70 p-4",
        state === "granted" && "border-[color-mix(in_srgb,var(--tab-success)_24%,transparent)] bg-[linear-gradient(145deg,var(--tab-success-tint),color-mix(in_srgb,var(--muted)_70%,transparent))]",
        state === "pending" && "border-[color-mix(in_srgb,var(--tab-signal)_22%,transparent)] bg-[linear-gradient(145deg,var(--tab-signal-tint),color-mix(in_srgb,var(--muted)_70%,transparent))]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-1">
          <h2 className="text-sm font-bold tracking-[-0.02em]">{title}</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <StatusBadge tone={tone}>{status}</StatusBadge>
      </div>
      {children ? <div className="text-sm leading-relaxed text-muted-foreground">{children}</div> : null}
    </article>
  );
}
