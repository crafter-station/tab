import type { PropsWithChildren, ReactNode } from "react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Separator } from "../ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { cn } from "../../lib/utils";

export type PatternTone = "neutral" | "success" | "warning" | "info" | "destructive";
export type SettingsNavItem = {
  label: string;
  href: string;
  active?: boolean;
};

type ThemeMode = "light" | "dark";

const toneClasses: Record<PatternTone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  success: "border-[color-mix(in_srgb,var(--success)_26%,transparent)] bg-[var(--tab-success-tint)] text-[var(--success)]",
  warning: "border-[color-mix(in_srgb,var(--warning)_30%,transparent)] bg-[var(--tab-warning-tint)] text-[var(--warning)]",
  info: "border-[color-mix(in_srgb,var(--info)_28%,transparent)] bg-[var(--tab-info-tint)] text-[var(--info)]",
  destructive: "border-[color-mix(in_srgb,var(--destructive)_28%,transparent)] bg-[color-mix(in_srgb,var(--destructive)_12%,transparent)] text-[var(--destructive)]",
};

const reviewThemeClasses: Record<ThemeMode, string> = {
  light: "pug-theme-light",
  dark: "pug-theme-dark",
};

const reviewModes: readonly ThemeMode[] = ["light", "dark"];

const reviewSettingsNavItems: readonly SettingsNavItem[] = [
  { label: "General", href: "#general", active: true },
  { label: "Memory", href: "#memory" },
  { label: "Debug", href: "#debug" },
];

type SectionBlockProps = PropsWithChildren<{
  className?: string;
  id?: string;
}>;

export function SectionBlock({ className, children, id }: SectionBlockProps) {
  return (
    <section
      id={id}
      className={cn(
        "rounded-[var(--radius-surface)] border border-border bg-card/88 p-5 shadow-[var(--tab-shadow-soft)] backdrop-blur sm:p-6",
        className,
      )}
    >
      {children}
    </section>
  );
}

type SurfaceHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

export function SurfaceHeader({ eyebrow, title, description, action, className }: SurfaceHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4 max-sm:flex-col", className)}>
      <div className="grid gap-2">
        {eyebrow ? <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{eyebrow}</p> : null}
        <h2 className="font-[var(--font-display)] text-2xl font-bold leading-tight tracking-[-0.045em] text-foreground">
          {title}
        </h2>
        {description ? <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

type StatusRowProps = {
  label: string;
  value: string;
  tone?: PatternTone;
  description?: string;
  meta?: ReactNode;
  className?: string;
};

export function StatusRow({ label, value, tone = "neutral", description, meta, className }: StatusRowProps) {
  return (
    <div className={cn("grid gap-3 rounded-[var(--radius-media)] border border-border bg-muted/45 p-4 sm:grid-cols-[1fr_auto] sm:items-center", className)}>
      <div className="grid gap-1">
        <p className="text-sm font-bold tracking-[-0.01em] text-foreground">{label}</p>
        {description ? <p className="text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
        {meta ? <div className="text-xs font-medium text-muted-foreground">{meta}</div> : null}
      </div>
      <Badge variant="outline" className={cn("justify-self-start", toneClasses[tone])}>
        {value}
      </Badge>
    </div>
  );
}

type EmptyStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("grid place-items-center rounded-[var(--radius-card)] border border-dashed border-border bg-muted/40 p-8 text-center", className)}>
      <div className="grid max-w-sm gap-3">
        <h3 className="font-[var(--font-display)] text-xl font-bold tracking-[-0.04em] text-foreground">{title}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
        {action ? <div className="justify-self-center text-sm font-bold text-foreground">{action}</div> : null}
      </div>
    </div>
  );
}

type CommandBlockProps = {
  command: string;
  label?: string;
  description?: string;
  className?: string;
};

export function CommandBlock({ command, label = "Command", description, className }: CommandBlockProps) {
  return (
    <div className={cn("rounded-[var(--radius-card)] border border-border bg-foreground p-4 text-background shadow-[var(--tab-shadow-soft)]", className)}>
      <p className="text-xs font-bold uppercase tracking-[0.14em] opacity-65">{label}</p>
      <code className="mt-2 block break-words font-[var(--font-code)] text-sm font-bold">{command}</code>
      {description ? <p className="mt-2 text-sm opacity-72">{description}</p> : null}
    </div>
  );
}

type SettingsNavProps = {
  items: readonly SettingsNavItem[];
  className?: string;
};

export function SettingsNav({ items, className }: SettingsNavProps) {
  return (
    <nav className={cn("flex flex-wrap gap-2 rounded-[var(--radius-card)] border border-border bg-muted/45 p-2", className)} aria-label="Settings navigation">
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "rounded-[var(--radius-control)] px-3 py-2 text-sm font-bold text-muted-foreground no-underline transition-colors hover:bg-card hover:text-foreground",
            item.active && "bg-card text-foreground shadow-sm",
          )}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}

type SettingsRowProps = PropsWithChildren<{
  label: string;
  description?: string;
  className?: string;
}>;

export function SettingsRow({ label, description, className, children }: SettingsRowProps) {
  return (
    <div className={cn("grid gap-3 border-b border-border py-4 last:border-b-0 sm:grid-cols-[1fr_auto] sm:items-center", className)}>
      <div className="grid gap-1">
        <p className="text-sm font-bold tracking-[-0.01em] text-foreground">{label}</p>
        {description ? <p className="text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {children ? <div className="text-sm font-medium text-foreground">{children}</div> : null}
    </div>
  );
}

function ReviewPanel({ mode }: { mode: ThemeMode }) {
  const inputId = `review-email-${mode}`;

  return (
    <Card data-theme={mode} className={reviewThemeClasses[mode]}>
      <CardContent className="grid gap-4 pt-5 sm:pt-6">
        <SurfaceHeader
          eyebrow={`${mode} mode`}
          title="Shared primitive review"
          description="Buttons, cards, status rows, settings navigation, command/debug blocks, and empty states on the Private Utility Grid system."
          action={<Button size="sm">Primary action</Button>}
        />
        <Separator />
        <div className="grid gap-3">
          <h3 className="text-sm font-bold">Status rows</h3>
          <StatusRow label="Native app" value="Connected" tone="success" description="Desktop handoff is linked to this account." />
          <StatusRow label="Quota" value="Watching" tone="warning" description="Status copy remains visible without relying on color." />
          <StatusRow label="Permission" value="Info: guided setup" tone="info" description="Permission copy stays readable in both modes." />
          <StatusRow label="Delete memory" value="Destructive: confirm first" tone="destructive" description="Risky actions are labeled before color is applied." />
        </div>
        <div className="grid gap-3">
          <h3 className="text-sm font-bold">Primitive controls</h3>
          <div className="grid gap-3 rounded-[var(--radius-card)] border border-border bg-muted/35 p-4">
            <Label htmlFor={inputId}>Email input</Label>
            <Input id={inputId} type="email" placeholder="writer@example.com" readOnly value="writer@example.com" />
            <div className="flex flex-wrap gap-2">
              <Button size="sm">Button</Button>
              <Button size="sm" variant="secondary">Secondary</Button>
              <Button size="sm" variant="outline">Outline</Button>
              <Button size="sm" variant="destructive">Destructive</Button>
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="ghost">Tooltip guidance</Button>
                </TooltipTrigger>
                <TooltipContent>Use tooltips for brief interface clarification only.</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Table aria-label="Plan table">
            <TableHeader>
              <TableRow>
                <TableHead>Plan table</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Free</TableCell>
                <TableCell><Badge variant="outline">Muted: available</Badge></TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Pro</TableCell>
                <TableCell><Badge>Active: upgrade path</Badge></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
        <div className="grid gap-3">
          <h3 className="text-sm font-bold">Settings navigation</h3>
          <SettingsNav items={reviewSettingsNavItems} />
          <SettingsRow label="Personal Memory" description="Review and delete memories from account surfaces.">
            Local controls
          </SettingsRow>
        </div>
        <CommandBlock command="debug:typing-context --active-application" label="debug:typing-context" />
        <EmptyState title="No Personal Memory yet" description="Tab will show saved memories here after you enable personalization." action="Open settings" />
      </CardContent>
    </Card>
  );
}

export function ComponentReviewSurface({ className }: { className?: string }) {
  return (
    <SectionBlock className={cn("pug-grid-surface grid gap-4", className)}>
      <SurfaceHeader
        eyebrow="Design system"
        title="Private Utility Grid components"
        description="A lightweight review surface for shared primitives and app-level Tab patterns in both supported theme modes."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {reviewModes.map((mode) => (
          <ReviewPanel key={mode} mode={mode} />
        ))}
      </div>
    </SectionBlock>
  );
}
