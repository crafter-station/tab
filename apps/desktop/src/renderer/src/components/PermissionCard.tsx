import type { PropsWithChildren } from "react";
import { StatusBadge } from "./StatusBadge";

type PermissionState = "granted" | "pending" | "manual";

type PermissionCardProps = PropsWithChildren<{
  title: string;
  description: string;
  status: string;
  state: PermissionState;
}>;

export function PermissionCard({ title, description, status, state, children }: PermissionCardProps) {
  const tone = state === "granted" ? "ok" : state === "pending" ? "warning" : "muted";

  return (
    <article className={`permission-card permission-card--${state}`}>
      <div className="permission-card__header">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <StatusBadge tone={tone}>{status}</StatusBadge>
      </div>
      {children ? <div className="permission-card__body">{children}</div> : null}
    </article>
  );
}
