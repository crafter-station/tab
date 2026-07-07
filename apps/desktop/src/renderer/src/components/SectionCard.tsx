import type { PropsWithChildren } from "react";

type SectionCardProps = PropsWithChildren<{
  className?: string;
}>;

export function SectionCard({ className, children }: SectionCardProps) {
  return <section className={["section-card", className].filter(Boolean).join(" ")}>{children}</section>;
}
