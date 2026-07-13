export type SemanticTone = "neutral" | "brand" | "success" | "warning" | "info" | "destructive";

export const semanticToneClasses: Record<SemanticTone, string> = {
  neutral: "border-border bg-[var(--tab-surface-sunken)] text-muted-foreground",
  brand: "border-[var(--tab-emphasis-border)] bg-[var(--tab-emphasis-tint)] text-emphasis-text",
  success: "border-[var(--tab-success-border)] bg-[var(--tab-success-tint)] text-[var(--success)]",
  warning: "border-[var(--tab-warning-border)] bg-[var(--tab-warning-tint)] text-[var(--warning)]",
  info: "border-[var(--tab-info-border)] bg-[var(--tab-info-tint)] text-[var(--info)]",
  destructive: "border-[var(--tab-destructive-border)] bg-[var(--tab-destructive-tint)] text-[var(--destructive)]",
};
