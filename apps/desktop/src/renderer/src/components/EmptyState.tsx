import type { PropsWithChildren } from "react";

type EmptyStateProps = PropsWithChildren<{
  title: string;
}>;

export function EmptyState({ title, children }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
    </div>
  );
}
