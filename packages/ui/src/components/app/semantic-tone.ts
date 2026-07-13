export type SemanticTone = "neutral" | "brand" | "success" | "warning" | "info" | "destructive";

export const semanticToneClasses: Record<SemanticTone, string> = {
  neutral: "border-border bg-[var(--tab-surface-sunken)] text-muted-foreground",
  brand: "border-[color-mix(in_srgb,var(--emphasis)_28%,transparent)] bg-[var(--tab-emphasis-tint)] text-emphasis-text",
  success: "border-[color-mix(in_srgb,var(--success)_26%,transparent)] bg-[var(--tab-success-tint)] text-[var(--success)]",
  warning: "border-[color-mix(in_srgb,var(--warning)_30%,transparent)] bg-[var(--tab-warning-tint)] text-[var(--warning)]",
  info: "border-[color-mix(in_srgb,var(--info)_28%,transparent)] bg-[var(--tab-info-tint)] text-[var(--info)]",
  destructive: "border-[color-mix(in_srgb,var(--destructive)_28%,transparent)] bg-[var(--tab-destructive-tint)] text-[var(--destructive)]",
};
