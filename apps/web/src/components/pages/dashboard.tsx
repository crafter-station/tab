import { planQuotas, type PlanId } from "@tab/billing";
import { ArrowLeft, Brain, CaretDown, ChartBar, Copy, Desktop, DotsThree, House, Moon, SidebarSimple, Sun, TextT, UserCircle } from "@phosphor-icons/react";
import { Outlet } from "@tanstack/react-router";
import { createContext, useContext, type ReactNode } from "react";
import type {
  BillingQuotaResponse,
  DeviceListItem,
  PersonalMemory,
  LocalSuggestionActivity,
} from "@tab/contracts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  EmptyState,
  Field,
  FieldDescription,
  FieldLabel,
  Progress,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  SurfaceHeader,
  TabMark,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  buttonVariants,
  cn,
  type SemanticTone,
} from "@tab/ui";
import { formatCount, formatDate, type User } from "./shared.tsx";

export type DashboardData = {
  user: User;
  quota: BillingQuotaResponse["data"];
  devices: readonly DeviceListItem[];
  memories: readonly PersonalMemory[];
  localSuggestionActivity: LocalSuggestionActivity;
};

export type DashboardSection = "overview" | "account" | "usage" | "devices" | "memories";

type PlanEntry = [PlanId, (typeof planQuotas)[PlanId]];
type StatusPresentation = { value: string; tone: SemanticTone };

const bulkDeleteMemoriesFormId = "bulk-delete-memories";
const DashboardDataContext = createContext<DashboardData | undefined>(undefined);

const dashboardSections = [
  {
    id: "account",
    href: "/dashboard/account",
    title: "Account",
    description: "Profile, email status, and sign out.",
  },
  {
    id: "usage",
    href: "/dashboard/usage",
    title: "Usage and billing",
    description: "Monthly suggestions, current plan, checkout, and billing settings.",
  },
  {
    id: "devices",
    href: "/dashboard/devices",
    title: "Devices",
    description: "Macs connected to this account.",
  },
  {
    id: "memories",
    href: "/dashboard/memories",
    title: "Memories",
    description: "Review, edit, and delete saved details.",
  },
] as const;

const dashboardDescriptions: Record<DashboardSection, string> = {
  overview: "A quick read on your plan, suggestions, connected Macs, and saved details.",
  account: "Your sign-in identity and email status.",
  usage: "See this month's suggestions and change your plan.",
  devices: "Review the Macs connected to your account and remove old access.",
  memories: "Review the details Tab can reuse when personalizing suggestions.",
};

const metricToneClasses: Record<SemanticTone, string> = {
  neutral: "bg-muted-foreground",
  success: "bg-[var(--success)]",
  warning: "bg-[var(--warning)]",
  info: "bg-[var(--info)]",
  destructive: "bg-[var(--destructive)]",
};

function getPlanEntries(): PlanEntry[] {
  return Object.entries(planQuotas) as PlanEntry[];
}

function isPlanId(planId: string): planId is PlanId {
  return planId in planQuotas;
}

function formatPlanName(planId: string): string {
  if (isPlanId(planId)) return planQuotas[planId].name;
  return planId.charAt(0).toUpperCase() + planId.slice(1);
}

function checkoutPlanHref(planId: PlanId): string {
  return `/billing/checkout?plan=${planId}`;
}

function planActionLabel(planName: string, monthlyPriceUsd: number): string {
  if (monthlyPriceUsd === 0) return `Switch to ${planName}`;
  return `Upgrade to ${planName}`;
}

function emailStatus(emailVerified: boolean | undefined): StatusPresentation {
  if (emailVerified === false) {
    return { value: "Verify your email", tone: "warning" };
  }

  return { value: "Email verified", tone: "success" };
}

function quotaStatus(quotaExhausted: boolean): StatusPresentation {
  if (quotaExhausted) {
    return { value: "Monthly suggestions used", tone: "warning" };
  }

  return { value: "Suggestions available", tone: "success" };
}

function DashboardMetric({
  label,
  value,
  description,
  tone,
}: {
  label: string;
  value: string;
  description?: string;
  tone?: SemanticTone;
}) {
  return (
    <div className="min-w-0 py-5 sm:px-5 sm:first:pl-0 sm:last:pr-0">
      <p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p>
      <p className="mt-2 flex min-w-0 items-center gap-2 text-xl font-bold text-foreground">
        {tone ? <span className={`size-2 shrink-0 rounded-full ${metricToneClasses[tone]}`} aria-hidden="true" /> : null}
        <span className="min-w-0">{value}</span>
      </p>
      {description ? <p className="mt-1 text-pretty text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
    </div>
  );
}

function QuotaProgressPanel({ title, usage, quota, resetAt }: { title: string; usage: number; quota: number; resetAt: string }) {
  const quotaUsed = Math.min(usage, quota);
  const quotaPercent = quota > 0 ? Math.round((quotaUsed / quota) * 100) : 0;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="font-[var(--font-code)] text-sm tabular-nums text-muted-foreground">{formatCount(usage)} of {formatCount(quota)}</p>
      </div>
      <Progress value={quotaPercent} aria-label={`${title} progress`} className="h-1.5 bg-border" />
      <div className="flex items-center justify-between gap-4 text-xs font-medium text-muted-foreground">
        <span>{quotaPercent}% used</span>
        <span>Resets {formatDate(resetAt)}</span>
      </div>
    </div>
  );
}

function deviceStatus(device: DeviceListItem): string {
  if (device.revoked) return "Access removed";
  return "Connected";
}

function memorySourceLabel(createdBy: PersonalMemory["createdBy"]): string {
  if (createdBy === "user") return "Saved by you";
  return "Saved from accepted writing";
}

function MemoryDate({ value }: { value: string }) {
  return <time dateTime={value}>{formatDate(value)}</time>;
}

function TableActionMenu({
  label,
  children,
  panelClassName = "w-[min(24rem,75vw)]",
}: {
  label: string;
  children: ReactNode;
  panelClassName?: string;
}) {
  return (
    <details className="group ml-auto w-max text-left">
      <summary className={buttonVariants({ variant: "ghost", size: "icon", className: "cursor-pointer list-none marker:hidden group-open:bg-muted [&::-webkit-details-marker]:hidden" })}>
        <DotsThree className="size-5" weight="bold" aria-hidden="true" />
        <span className="sr-only">{label}</span>
      </summary>
      <div className={`tab-disclosure-panel mt-2 rounded-[var(--radius-media)] border border-border bg-popover p-2 text-popover-foreground ${panelClassName}`}>
        {children}
      </div>
    </details>
  );
}

function DashboardHeader({ section }: { section: DashboardSection }) {
  const title = section === "overview"
    ? "Dashboard"
    : dashboardSections.find((item) => item.id === section)?.title ?? "Dashboard";

  return (
    <SurfaceHeader
      eyebrow="Your Tab account"
      title={title}
      description={dashboardDescriptions[section]}
      headingLevel={1}
    />
  );
}

const dashboardNavigation = [
  { id: "overview", href: "/dashboard", label: "Overview", icon: House },
  { id: "account", href: "/dashboard/account", label: "Account", icon: UserCircle },
  { id: "usage", href: "/dashboard/usage", label: "Usage and billing", icon: ChartBar },
  { id: "devices", href: "/dashboard/devices", label: "Devices", icon: Desktop },
  { id: "memories", href: "/dashboard/memories", label: "Memories", icon: Brain },
] as const;

const tabLogoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="Tab logo"><rect width="32" height="32" rx="8" fill="#20221f"/><path fill="#f8f9f6" d="M9 8h14v4h-5v12h-4V12H9z"/></svg>`;

function DashboardBrandMenu() {
  const modes = [
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon },
    { id: "system", label: "System", icon: Desktop },
  ] as const;

  return (
    <details className="dashboard-brand-menu group relative" name="dashboard-brand-menu">
      <summary className={buttonVariants({ variant: "secondary", size: "icon", className: "list-none marker:hidden [&::-webkit-details-marker]:hidden" })} aria-label="Open Tab menu">
        <TabMark className="size-6 rounded-[5px] border-0 shadow-none" />
      </summary>
      <div className="dashboard-brand-menu-panel tab-disclosure-panel absolute right-0 z-50 mt-2 grid w-64 gap-1 rounded-[var(--radius-card)] border border-border bg-popover p-2 text-popover-foreground shadow-[var(--tab-shadow-card)]">
        <button
          type="button"
          data-copy-tab-logo
          className="flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-left text-sm font-semibold hover:bg-accent hover:text-accent-foreground"
          onClick={() => void navigator.clipboard.writeText(tabLogoSvg)}
        >
          <Copy className="size-4" aria-hidden="true" />
          <span>Copy Logo as SVG</span>
        </button>
        <button type="button" disabled className="flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-left text-sm font-semibold opacity-45">
          <TextT className="size-4" aria-hidden="true" />
          <span>Copy Wordmark as SVG</span>
          <span className="sr-only">Coming later</span>
        </button>
        <button type="button" disabled className="flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-left text-sm font-semibold opacity-45">
          <span className="size-4 rounded border border-dashed border-current" aria-hidden="true" />
          <span>Brand Guidelines</span>
          <span className="sr-only">Coming later</span>
        </button>
        <a href="/" className="mt-1 flex items-center gap-3 rounded-[var(--radius-control)] bg-muted px-3 py-2.5 text-sm font-semibold text-foreground no-underline hover:bg-accent hover:text-accent-foreground">
          <House className="size-4" aria-hidden="true" />
          <span>Home Page</span>
        </a>
        <div className="mt-1 flex items-center justify-between border-t border-border px-2 pt-2" aria-label="Theme selection">
          <span className="text-xs font-medium text-muted-foreground">Theme</span>
          <div className="flex items-center gap-1">
            {modes.map((mode) => {
              const Icon = mode.icon;
              return (
                <button key={mode.id} type="button" data-theme-choice={mode.id} aria-pressed="false" aria-label={`${mode.label} theme`} className="grid size-7 place-items-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-accent hover:text-accent-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground">
                  <Icon className="size-3.5" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </details>
  );
}

function DashboardSidebar({ active }: { active: DashboardSection }) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip="Tab dashboard">
              <a href="/dashboard" aria-label="Tab dashboard">
                <TabMark className="border-sidebar-primary bg-sidebar-primary text-sidebar-primary-foreground" />
                <span className="grid min-w-0 text-left leading-tight">
                  <span className="truncate font-[var(--font-display)] font-bold">Tab</span>
                  <span className="truncate text-xs text-sidebar-foreground/60">Account workspace</span>
                </span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {dashboardNavigation.map((item) => {
                const Icon = item.icon;
                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton asChild isActive={active === item.id} tooltip={item.label}>
                      <a href={item.href} aria-current={active === item.id ? "page" : undefined}>
                        <Icon aria-hidden="true" />
                        <span>{item.label}</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Back to website">
              <a href="/">
                <ArrowLeft aria-hidden="true" />
                <span>Back to website</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function DashboardStaticSidebar({ active }: { active: DashboardSection }) {
  return (
    <aside id="dashboard-sidebar" className="dashboard-static-sidebar hidden w-64 shrink-0 overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex md:flex-col">
      <a className="dashboard-static-sidebar-brand flex h-16 shrink-0 items-center gap-3 border-b border-sidebar-border px-4 no-underline" href="/dashboard">
        <TabMark className="border-sidebar-primary bg-sidebar-primary text-sidebar-primary-foreground" />
        <span className="dashboard-static-sidebar-label grid min-w-0 leading-tight">
          <span className="truncate font-[var(--font-display)] font-bold">Tab</span>
          <span className="truncate text-xs text-sidebar-foreground/60">Account workspace</span>
        </span>
      </a>
      <nav className="dashboard-static-sidebar-nav flex flex-1 flex-col gap-1 p-3" aria-label="Dashboard navigation">
        <p className="dashboard-static-sidebar-label px-2 pb-1 pt-2 text-xs font-medium text-sidebar-foreground/60">Workspace</p>
        {dashboardNavigation.map((item) => {
          const Icon = item.icon;
          return (
            <a
              key={item.id}
              href={item.href}
              aria-current={active === item.id ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-[var(--radius-control)] px-2 py-2 text-sm font-medium no-underline",
                active === item.id ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/70",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              <span className="dashboard-static-sidebar-label">{item.label}</span>
            </a>
          );
        })}
      </nav>
      <a className="dashboard-static-sidebar-footer m-3 flex items-center gap-2 rounded-[var(--radius-control)] border-t border-sidebar-border px-2 py-3 text-sm font-medium text-sidebar-foreground no-underline" href="/">
        <ArrowLeft className="size-4" aria-hidden="true" />
        <span className="dashboard-static-sidebar-label whitespace-nowrap">Back to website</span>
      </a>
    </aside>
  );
}

function DashboardContent({ data, section, children }: { data?: DashboardData; section: DashboardSection; children?: ReactNode }) {
  return (
    <main id="main-content" className="w-full flex-1 px-5 py-7 sm:px-8 sm:py-10 lg:px-10">
      <div className="mx-auto grid w-full max-w-6xl gap-8">
        <DashboardHeader section={section} />
        {data ? (
          <DashboardDataContext.Provider value={data}>
            {children ?? <Outlet />}
          </DashboardDataContext.Provider>
        ) : <DashboardPlaceholder />}
      </div>
    </main>
  );
}

function DashboardPlaceholder() {
  return (
    <div className="grid border-y border-border sm:grid-cols-2">
      {dashboardSections.map((item) => (
        <a key={item.id} className="group grid gap-2 border-b border-border py-5 text-foreground no-underline sm:px-5 sm:odd:border-r sm:[&:nth-last-child(-n+2)]:border-b-0 sm:odd:pl-0 sm:even:pr-0" href={item.href}>
          <span className="flex items-center justify-between gap-3 font-semibold"><span>{item.title}</span><span className="text-muted-foreground transition-transform duration-150 ease-[var(--tab-ease-out)] group-hover:translate-x-0.5" aria-hidden="true">-&gt;</span></span>
          <span className="text-sm leading-relaxed text-muted-foreground">{item.description}</span>
        </a>
      ))}
    </div>
  );
}

export function DashboardLayout({
  data,
  section = "overview",
  children,
}: {
  data?: DashboardData;
  section?: DashboardSection;
  children?: ReactNode;
}) {
  return (
    <SidebarProvider>
      <DashboardSidebar active={section} />
      <SidebarInset className="min-w-0 bg-background">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-background/90 px-4 backdrop-blur-md sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <SidebarTrigger className="-ml-1" />
            <span className="h-4 w-px bg-border" aria-hidden="true" />
            <p className="truncate text-sm font-semibold">Account dashboard</p>
          </div>
          <DashboardBrandMenu />
        </header>
        <DashboardContent data={data} section={section}>{children}</DashboardContent>
      </SidebarInset>
    </SidebarProvider>
  );
}

function DashboardStaticLayout({ data, section, children }: { data: DashboardData; section: DashboardSection; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-background">
      <DashboardStaticSidebar active={section} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border px-5 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              data-dashboard-sidebar-toggle
              aria-expanded="true"
              aria-controls="dashboard-sidebar"
              className={buttonVariants({ variant: "ghost", size: "icon", className: "-ml-2 hidden md:inline-flex" })}
            >
              <SidebarSimple aria-hidden="true" />
              <span className="sr-only">Collapse sidebar</span>
            </button>
            <span className="hidden h-4 w-px bg-border md:block" aria-hidden="true" />
            <p className="truncate text-sm font-semibold">Account dashboard</p>
          </div>
          <DashboardBrandMenu />
        </header>
        <DashboardContent data={data} section={section}>{children}</DashboardContent>
      </div>
    </div>
  );
}

export function useDashboardData(): DashboardData {
  const data = useContext(DashboardDataContext);
  if (!data) {
    throw new Error("Dashboard data is not available outside the dashboard layout.");
  }
  return data;
}

export function DashboardOverviewPage({ data }: { data: DashboardData }) {
  const connectedDevices = data.devices.filter((device) => !device.revoked).length;
  const accountEmailStatus = emailStatus(data.user.emailVerified);

  return (
    <div className="grid gap-8">
      <section className="grid gap-px border-y border-border bg-border sm:grid-cols-2 lg:grid-cols-5 [&>*]:bg-background">
        <DashboardMetric label="Plan" value={formatPlanName(data.quota.planId)} />
        <DashboardMetric label="Connected Macs" value={formatCount(connectedDevices)} description={`${formatCount(data.devices.length)} device records`} />
        <DashboardMetric label="Saved memories" value={formatCount(data.memories.length)} description="Available when enabled" />
        <DashboardMetric label="Local accepted" value={formatCount(data.localSuggestionActivity.accepted)} description="This month" />
        <DashboardMetric label="Account" value={accountEmailStatus.value} tone={accountEmailStatus.tone} description={data.user.email ?? data.user.name ?? data.user.id} />
      </section>
      <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
        <div className="border-y border-border py-6">
          <QuotaProgressPanel title="Suggestions this month" usage={data.quota.usage} quota={data.quota.quota} resetAt={data.quota.resetAt} />
        </div>
        <div className="grid gap-3 lg:border-l lg:border-border lg:pl-7">
          <p className="text-sm font-semibold text-foreground">{data.quota.usage >= data.quota.quota ? "You have reached this month's limit." : "Your plan is ready when you are."}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{data.quota.usage >= data.quota.quota ? "Choose a larger plan to keep using suggestions this month." : "See your allowance or make a billing change."}</p>
          <p><a className={buttonVariants({ variant: "secondary", size: "sm" })} href="/dashboard/usage">View usage and billing</a></p>
        </div>
      </section>
    </div>
  );
}

export function DashboardAccountPage({ data }: { data: DashboardData }) {
  const accountName = data.user.email ?? data.user.name ?? data.user.id;
  const accountEmailStatus = emailStatus(data.user.emailVerified);

  return (
    <section className="border-y border-border">
      <div className="flex flex-col gap-5 py-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase text-muted-foreground">Signed-in account</p>
          <p className="mt-2 truncate text-lg font-semibold text-foreground">{accountName}</p>
        </div>
        <form method="post" action="/logout"><Button type="submit" variant="secondary">Sign out</Button></form>
      </div>
      <div className="grid gap-2 border-t border-border py-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div>
          <p className="flex items-center gap-2 font-semibold text-foreground">
            <span className={`size-2 rounded-full ${metricToneClasses[accountEmailStatus.tone]}`} aria-hidden="true" />
            {accountEmailStatus.value}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">A verified email may be required before choosing a paid plan.</p>
        </div>
      </div>
    </section>
  );
}

export function DashboardUsagePage({ data }: { data: DashboardData }) {
  const quota = data.quota;
  const upgradePlans = getPlanEntries().filter(([planId]) => planId !== quota.planId);
  const quotaExhausted = quota.usage >= quota.quota;
  const accountQuotaStatus = quotaStatus(quotaExhausted);

  return (
    <div className="grid gap-9">
      <section className="grid gap-5 border-y border-border py-6">
        <div className="grid gap-px border-b border-border bg-border sm:grid-cols-2 [&>*]:bg-background">
          <DashboardMetric label="Local accepted" value={formatCount(data.localSuggestionActivity.accepted)} description="Successful local insertions this month" />
          <DashboardMetric
            label="Average time to accept"
            value={data.localSuggestionActivity.averageAcceptanceLatencyMs === null
              ? "Not available"
              : `${formatCount(data.localSuggestionActivity.averageAcceptanceLatencyMs)} ms`}
            description="From first visible suggestion to insertion"
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground">Current plan</p>
            <p className="mt-2 text-xl font-bold">{formatPlanName(quota.planId)}</p>
          </div>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span className={`size-2 rounded-full ${metricToneClasses[accountQuotaStatus.tone]}`} aria-hidden="true" />
            {accountQuotaStatus.value}
          </p>
        </div>
        <QuotaProgressPanel title="Suggestions this month" usage={quota.usage} quota={quota.quota} resetAt={quota.resetAt} />
        {quotaExhausted ? (
          <Alert variant="destructive">
            <AlertTitle>Monthly suggestions used</AlertTitle>
            <AlertDescription>
              You have used {formatCount(quota.usage)} of {formatCount(quota.quota)} suggestions this month. <a className="underline" href="/pricing">Upgrade to continue</a>.
            </AlertDescription>
          </Alert>
        ) : null}
      </section>
      <section>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-bold">Change plan</h2>
            <p className="mt-1 text-sm text-muted-foreground">A new allowance applies after checkout.</p>
          </div>
          <a className={buttonVariants({ variant: "secondary", size: "sm" })} href="/billing/portal">Manage billing</a>
        </div>
        <div className="mt-5 grid border-y border-border sm:grid-cols-2">
            {upgradePlans.map(([planId, plan]) => (
              <div key={planId} className="grid gap-4 border-b border-border py-5 sm:border-b-0 sm:border-l sm:px-5 sm:first:border-l-0 sm:first:pl-0 sm:last:pr-0">
                <div>
                  <p className="font-semibold">{plan.name}</p>
                  <p className="mt-1 text-sm tabular-nums text-muted-foreground">{formatCount(plan.monthlyAutocompleteSuggestions)} suggestions / month</p>
                </div>
                <p><a className={buttonVariants({ variant: "secondary", size: "sm" })} href={checkoutPlanHref(planId)}>{planActionLabel(plan.name, plan.monthlyPriceUsd)}</a></p>
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}

export function DashboardDevicesPage({ data }: { data: DashboardData }) {
  const devices = data.devices;
  const activeDeviceCount = devices.filter((device) => !device.revoked).length;
  const revokedDeviceCount = devices.length - activeDeviceCount;

  return (
    <section id="devices" className="grid gap-6">
      <div className="grid gap-px border-y border-border bg-border sm:grid-cols-3 [&>*]:bg-background">
        <DashboardMetric label="Connected" value={formatCount(activeDeviceCount)} description="Can use this account" />
        <DashboardMetric label="Removed" value={formatCount(revokedDeviceCount)} description="Access already revoked" />
        <DashboardMetric label="Safety" value="Review old Macs" description="Remove anything unfamiliar" />
      </div>
      {devices.length === 0 ? (
          <EmptyState
            title="No linked devices"
            description="No Macs are connected yet. Sign in from the Mac app to connect one."
          />
        ) : (
          <Table aria-label="Connected Macs">
            <caption className="sr-only">Connected Macs and access status</caption>
            <TableHeader>
              <TableRow>
                <TableHead>Device</TableHead>
                <TableHead className="hidden sm:table-cell">Platform</TableHead>
                <TableHead className="hidden md:table-cell">Version</TableHead>
                <TableHead className="hidden lg:table-cell">Added</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-16 text-right"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((device) => (
                <TableRow key={device.id}>
                  <TableCell className="max-w-40 break-all font-[var(--font-code)] text-xs">{device.deviceId}</TableCell>
                  <TableCell className="hidden sm:table-cell">{device.platform}</TableCell>
                  <TableCell className="hidden md:table-cell">{device.appVersion}</TableCell>
                  <TableCell className="hidden lg:table-cell">{formatDate(device.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant={device.revoked ? "secondary" : "default"}>{deviceStatus(device)}</Badge>
                  </TableCell>
                  <TableCell className="text-right align-top">
                    {device.revoked ? null : (
                      <TableActionMenu label={`Actions for ${device.deviceId}`} panelClassName="w-[min(18rem,75vw)]">
                        <form method="post" action={`/dashboard/devices/${encodeURIComponent(device.deviceId)}/revoke`} className="grid gap-2">
                          <p className="text-sm font-bold text-foreground">Remove this Mac?</p>
                          <p className="text-xs leading-relaxed text-muted-foreground">It will need to sign in again before using Tab.</p>
                          <input type="hidden" name="confirm" value={device.deviceId} />
                          <Button type="submit" size="sm" variant="destructive" className="mt-1 w-max">Remove access</Button>
                        </form>
                      </TableActionMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
    </section>
  );
}

export function DashboardMemoriesPage({ data }: { data: DashboardData }) {
  const memories = data.memories;
  const memoryCountLabel = `${formatCount(memories.length)} ${memories.length === 1 ? "memory" : "memories"}`;
  const savedByUserCount = memories.filter((memory) => memory.createdBy === "user").length;
  const savedFromWritingCount = memories.length - savedByUserCount;

  return (
    <section id="memories" className="grid gap-6">
      <div className="grid gap-px border-y border-border bg-border sm:grid-cols-3 [&>*]:bg-background">
        <DashboardMetric label="Saved" value={memoryCountLabel} description="Ready when memory is enabled" />
        <DashboardMetric label="Added by you" value={formatCount(savedByUserCount)} description="Created or updated manually" />
        <DashboardMetric label="Learned from writing" value={formatCount(savedFromWritingCount)} description="From suggestions you accepted" />
      </div>
      <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-[65ch] leading-relaxed text-muted-foreground">Saved memories can personalize suggestions when memory is enabled in the Mac app.</p>
        <span className="w-max text-xs font-semibold text-muted-foreground">Controlled on each Mac</span>
      </div>
      <details className="border-y border-border py-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--radius-control)] py-1 text-sm font-semibold text-foreground hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <span>Add a memory</span>
            <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              Up to 500 characters
              <CaretDown className="tab-disclosure-chevron size-4" aria-hidden="true" />
            </span>
          </summary>
          <form method="post" action="/dashboard/memories/create" className="tab-disclosure-panel mt-3 grid gap-3">
            <Field>
              <FieldLabel htmlFor="memory-content">Memory content</FieldLabel>
              <Textarea
                id="memory-content"
                name="content"
                maxLength={500}
                required
                rows={3}
                autoComplete="off"
                className="min-h-20"
                placeholder="Example: I prefer concise morning status summaries..."
              />
              <FieldDescription>Only save details you are comfortable reusing.</FieldDescription>
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm">Save Memory</Button>
            </div>
          </form>
      </details>
      {memories.length === 0 ? (
          <EmptyState
            title="No saved memories yet"
            description="Add a saved memory when you want Tab to personalize suggestions."
          />
        ) : (
          <div className="grid gap-3">
            <form id={bulkDeleteMemoriesFormId} method="post" action="/dashboard/memories/delete-selected" />
            <div className="flex flex-col gap-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="grid gap-1">
                <p className="text-sm font-bold text-foreground">Memory library</p>
                <p id="bulk-memory-delete-guidance" className="text-sm text-muted-foreground">
                  Select one or more memories to remove them together.
                </p>
              </div>
              <details className="group relative w-max">
                <summary className={buttonVariants({ variant: "secondary", size: "sm", className: "cursor-pointer list-none marker:hidden [&::-webkit-details-marker]:hidden" })}>Delete selected...</summary>
                <div className="tab-disclosure-panel absolute right-0 z-20 mt-2 grid w-[min(20rem,80vw)] gap-3 rounded-[var(--radius-card)] border border-border bg-popover p-3 text-popover-foreground shadow-[var(--tab-shadow-card)]">
                  <div>
                    <p className="text-sm font-semibold">Delete selected memories?</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">This cannot be undone. If nothing is selected, no changes are made.</p>
                  </div>
                  <input form={bulkDeleteMemoriesFormId} type="hidden" name="confirm" value="delete-selected-memories" />
                  <Button aria-describedby="bulk-memory-delete-guidance" form={bulkDeleteMemoriesFormId} type="submit" size="sm" variant="destructive">Delete selected memories</Button>
                </div>
              </details>
            </div>
            <Table aria-label="Saved memories">
              <caption className="sr-only">Saved memories available for personalized suggestions</caption>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Select</TableHead>
                  <TableHead>Memory</TableHead>
                  <TableHead className="hidden sm:table-cell">Source</TableHead>
                  <TableHead className="hidden md:table-cell">Updated</TableHead>
                  <TableHead className="w-16 text-right"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memories.map((memory) => (
                  <TableRow key={memory.id}>
                    <TableCell>
                      <FieldLabel className="flex size-10 items-center justify-center rounded-[var(--radius-control)] border border-border bg-muted/30 hover:bg-muted">
                        <span className="sr-only">Select memory updated {formatDate(memory.updatedAt)}</span>
                        <input
                          form={bulkDeleteMemoriesFormId}
                          type="checkbox"
                          name="memoryId"
                          value={memory.id}
                          className="size-4 accent-foreground"
                        />
                      </FieldLabel>
                    </TableCell>
                    <TableCell className="min-w-52 max-w-[40rem]">
                      <p className="max-w-[65ch] whitespace-pre-wrap break-words text-base leading-relaxed text-foreground">{memory.content}</p>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant="outline" className="w-max whitespace-nowrap">{memorySourceLabel(memory.createdBy)}</Badge>
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap font-[var(--font-code)] text-xs tabular-nums text-muted-foreground md:table-cell">
                      <MemoryDate value={memory.updatedAt} />
                    </TableCell>
                    <TableCell className="text-right align-top">
                      <TableActionMenu label={`Actions for memory updated ${formatDate(memory.updatedAt)}`} panelClassName="w-[min(38rem,80vw)]">
                        <div className="grid gap-2">
                          <details className="border-t border-border py-1">
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-1 py-2 text-xs font-semibold text-foreground hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                              <span>Update</span>
                              <CaretDown className="tab-disclosure-chevron size-3.5" aria-hidden="true" />
                            </summary>
                            <form method="post" action={`/dashboard/memories/${encodeURIComponent(memory.id)}/edit`} className="tab-disclosure-panel mt-2 grid w-full gap-2">
                              <Field>
                                <FieldLabel htmlFor={`memory-${memory.id}-content`}>Memory content</FieldLabel>
                                <Textarea
                                  id={`memory-${memory.id}-content`}
                                  name="content"
                                  maxLength={500}
                                  required
                                  rows={3}
                                  autoComplete="off"
                                  className="min-h-20"
                                  defaultValue={memory.content}
                                />
                              </Field>
                              <div className="flex flex-wrap items-center gap-2">
                                <Button type="submit" size="sm">Update Memory</Button>
                                <a className={buttonVariants({ size: "sm", variant: "secondary" })} href="/dashboard/memories">Cancel</a>
                              </div>
                            </form>
                          </details>
                          <details className="border-t border-destructive/25 py-1">
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-1 py-2 text-xs font-semibold text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                              <span>Delete</span>
                              <CaretDown className="tab-disclosure-chevron size-3.5" aria-hidden="true" />
                            </summary>
                            <form method="post" action={`/dashboard/memories/${encodeURIComponent(memory.id)}/delete`} className="tab-disclosure-panel mt-2 grid gap-2 sm:w-80">
                              <Alert variant="destructive" className="p-2 text-xs">
                                <AlertTitle>Delete this saved detail?</AlertTitle>
                                <AlertDescription>This cannot be undone.</AlertDescription>
                              </Alert>
                              <input type="hidden" name="confirm" value="delete-memory" />
                              <Button type="submit" size="sm" variant="destructive" className="w-max">Delete Memory</Button>
                            </form>
                          </details>
                        </div>
                      </TableActionMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
    </section>
  );
}

export function DashboardPage({ data, section = "overview" }: { data?: DashboardData; section?: DashboardSection }) {
  if (!data) {
    return <DashboardLayout section={section} />;
  }

  const pageBySection = {
    overview: <DashboardOverviewPage data={data} />,
    account: <DashboardAccountPage data={data} />,
    usage: <DashboardUsagePage data={data} />,
    devices: <DashboardDevicesPage data={data} />,
    memories: <DashboardMemoriesPage data={data} />,
  } satisfies Record<DashboardSection, ReactNode>;

  return (
    <DashboardStaticLayout data={data} section={section}>
      {pageBySection[section]}
    </DashboardStaticLayout>
  );
}
