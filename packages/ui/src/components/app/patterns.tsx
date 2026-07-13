import type { PropsWithChildren, ReactNode } from "react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Separator } from "../ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { cn } from "../../lib/utils";
import { semanticToneClasses, type SemanticTone } from "./semantic-tone";

export type SettingsNavItem = {
  label: string;
  href: string;
  active?: boolean;
};

type ThemeMode = "light" | "dark";

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

const reviewPlanRows = [
  { plan: "Free", status: <Badge variant="outline">Available</Badge> },
  { plan: "Pro", status: <Badge>Upgrade available</Badge> },
] as const;

type SectionBlockProps = PropsWithChildren<{
  className?: string;
  id?: string;
}>;

export function SectionBlock({ className, children, id }: SectionBlockProps) {
  return (
    <section
      id={id}
      className={cn(
        "border-t border-border bg-transparent py-6 sm:py-8",
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
  headingLevel?: 1 | 2 | 3;
};

type EyebrowProps = PropsWithChildren<{
  className?: string;
}>;

export function Eyebrow({ className, children }: EyebrowProps) {
  return (
    <p className={cn("font-mono text-[11px] font-semibold uppercase text-emphasis-text", className)}>
      {children}
    </p>
  );
}

export function TabMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-[var(--radius-media)] border border-primary bg-primary font-mono text-xs font-bold text-primary-foreground shadow-[var(--tab-shadow-control)]",
        className,
      )}
    >
      T
    </span>
  );
}

export function SurfaceHeader({ eyebrow, title, description, action, className, headingLevel = 2 }: SurfaceHeaderProps) {
  const Heading = `h${headingLevel}` as const;

  return (
    <div className={cn("flex items-start justify-between gap-4 max-sm:flex-col", className)}>
      <div className="grid gap-2">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <Heading className={cn("text-balance font-[var(--font-display)] font-semibold leading-tight text-foreground", headingLevel === 1 ? "text-3xl tracking-[-0.015em]" : "text-2xl tracking-[-0.01em]")}>
          {title}
        </Heading>
        {description ? <p className="max-w-[65ch] text-pretty text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

type StatusRowProps = {
  label: string;
  value: string;
  tone?: SemanticTone;
  description?: string;
  meta?: ReactNode;
  className?: string;
};

export function StatusRow({ label, value, tone = "neutral", description, meta, className }: StatusRowProps) {
  return (
    <div className={cn("grid gap-3 border-b border-border py-4 last:border-b-0 sm:grid-cols-[1fr_auto] sm:items-center", className)}>
      <div className="grid gap-1">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        {description ? <p className="max-w-[65ch] text-pretty text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
        {meta ? <div className="text-xs font-medium text-muted-foreground">{meta}</div> : null}
      </div>
      <Badge variant="outline" className={cn("justify-self-start", semanticToneClasses[tone])}>
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
    <div className={cn("grid place-items-center rounded-[var(--radius-card)] bg-[var(--tab-surface-sunken)] px-6 py-9 text-center", className)}>
      <div className="grid max-w-sm gap-3">
        <h3 className="text-balance font-[var(--font-display)] text-lg font-semibold text-foreground">{title}</h3>
        <p className="text-pretty text-sm leading-relaxed text-muted-foreground">{description}</p>
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
    <div className={cn("rounded-[var(--radius-media)] border border-border bg-foreground p-4 text-background", className)}>
      <p className="text-xs font-semibold uppercase opacity-65">{label}</p>
      <code className="mt-2 block break-words font-[var(--font-code)] text-sm font-semibold">{command}</code>
      {description ? <p className="mt-2 text-sm opacity-72">{description}</p> : null}
    </div>
  );
}

type SettingsNavProps = {
  items: readonly SettingsNavItem[];
  className?: string;
  "aria-label"?: string;
};

export function SettingsNav({ items, className, "aria-label": ariaLabel = "Settings navigation" }: SettingsNavProps) {
  return (
    <nav className={cn("flex w-full flex-nowrap gap-x-5 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)} aria-label={ariaLabel}>
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "shrink-0 whitespace-nowrap border-b-2 border-transparent py-3 text-sm font-semibold text-muted-foreground no-underline transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            item.active && "border-foreground text-foreground",
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
        <p className="text-sm font-semibold text-foreground">{label}</p>
        {description ? <p className="text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {children ? <div className="text-sm font-medium text-foreground">{children}</div> : null}
    </div>
  );
}

type SettingsGroupProps = PropsWithChildren<{
  title: string;
  description?: string;
  className?: string;
}>;

export function SettingsGroup({ title, description, className, children }: SettingsGroupProps) {
  return (
    <Card className={cn("overflow-hidden border-0 bg-[var(--tab-surface-sunken)]/55 shadow-none", className)}>
      <CardHeader className="pb-3">
        <CardTitle headingLevel={2}>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

type SummaryMetricProps = {
  label: string;
  value: string;
  detail?: string;
  className?: string;
};

export function SummaryMetric({ label, value, detail, className }: SummaryMetricProps) {
  return (
    <div className={cn("grid min-w-0 gap-1 px-1 py-2", className)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="truncate text-xl font-semibold text-foreground tabular-nums">{value}</p>
      {detail ? <p className="truncate text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

function ReviewPrimitiveControls({ inputId }: { inputId: string }) {
  return (
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
        <Button size="sm" variant="ghost" aria-describedby={`${inputId}-guidance`}>
          Tooltip guidance
        </Button>
        <p id={`${inputId}-guidance`} className="text-xs leading-relaxed text-muted-foreground">
          Use tooltips for brief interface clarification only.
        </p>
      </div>
      <Table aria-label="Plan table">
        <TableHeader>
          <TableRow>
            <TableHead>Plan table</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reviewPlanRows.map((row) => (
            <TableRow key={row.plan}>
              <TableCell>{row.plan}</TableCell>
              <TableCell>{row.status}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
          description="Buttons, cards, status rows, settings navigation, command blocks, and empty states for Tab surfaces."
          action={<Button size="sm">Primary action</Button>}
        />
        <Separator />
        <div className="grid gap-3">
          <h3 className="text-sm font-bold">Status rows</h3>
          <StatusRow label="Native app" value="Connected" tone="success" description="Desktop handoff is linked to this account." />
          <StatusRow label="Quota" value="Watching" tone="warning" description="Status copy remains visible without relying on color." />
          <StatusRow label="Permission" value="Guided setup" tone="info" description="Permission copy stays readable in both modes." />
          <StatusRow label="Delete memory" value="Confirm first" tone="destructive" description="Risky actions are labeled before color is applied." />
        </div>
        <ReviewPrimitiveControls inputId={inputId} />
        <div className="grid gap-3">
          <h3 className="text-sm font-bold">Settings navigation</h3>
          <SettingsNav items={reviewSettingsNavItems} />
          <SettingsRow label="Saved memories" description="Review and delete memories from account surfaces.">
            Local controls
          </SettingsRow>
        </div>
        <CommandBlock command="tab diagnostics" label="Developer diagnostics" />
        <EmptyState title="No saved memories yet" description="Tab will show saved memories here after you enable personalization." action="Open settings" />
      </CardContent>
    </Card>
  );
}

export function ComponentReviewSurface({ className }: { className?: string }) {
  return (
    <SectionBlock className={cn("pug-grid-surface grid gap-4", className)}>
      <SurfaceHeader
        eyebrow="Design system"
        title="Tab components"
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
