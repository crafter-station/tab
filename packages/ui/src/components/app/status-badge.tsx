import type { PropsWithChildren } from "react";
import { Badge } from "../ui/badge";
import { cn } from "../../lib/utils";
import { semanticToneClasses, type SemanticTone } from "./semantic-tone";

export type StatusBadgeTone = SemanticTone;

type StatusBadgeProps = PropsWithChildren<{
  tone?: StatusBadgeTone;
  className?: string;
}>;

export function StatusBadge({ tone = "neutral", className, children }: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        semanticToneClasses[tone],
        className,
      )}
    >
      {children}
    </Badge>
  );
}
