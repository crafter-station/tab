import { planQuotas, type PlanId } from "@tab/billing";
import type { ReactNode } from "react";
import type {
  BillingQuotaResponse,
  DeviceListItem,
  PersonalMemory,
} from "@tab/contracts";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  SectionBlock,
  Separator,
  SettingsNav,
  StatusRow,
  SurfaceHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  buttonVariants,
  type PatternTone,
} from "@tab/ui";

export type User = {
  id: string;
  name?: string;
  email?: string;
  emailVerified?: boolean;
};

export type AuthSearch = {
  device_id?: string;
  callback?: string;
  next?: string;
};

export type DashboardData = {
  user: User;
  quota: BillingQuotaResponse["data"];
  devices: readonly DeviceListItem[];
  memories: readonly PersonalMemory[];
};

export type DashboardSection = "overview" | "account" | "usage" | "devices" | "memories";

const authTitleClassName = "font-[var(--font-display)] text-4xl font-black tracking-[-0.06em]";
const quotaExhaustedClassName = "rounded-lg border border-warning/30 bg-[var(--tab-warning-tint)] p-3 text-warning";
const bulkDeleteMemoriesFormId = "bulk-delete-memories";

const homeProofRows = [
  {
    label: "Recent typing",
    value: "Used for suggestions",
    tone: "success",
    description: "Tab uses what you are typing to prepare a suggestion you can choose to add.",
  },
  {
    label: "Saved memories",
    value: "You control them",
    tone: "info",
    description: "Review and delete saved details from your dashboard.",
  },
  {
    label: "Suggestion bar",
    value: "Stays out of the way",
    tone: "neutral",
    description: "The suggestion appears only when Tab has something useful to add.",
  },
] as const;

const homeFeatureBlocks = [
  {
    eyebrow: "01",
    title: "Works where you write",
    description: "Use one Mac app across Mail, Slack, Notes, Ghostty, and the places you already type.",
  },
  {
    eyebrow: "02",
    title: "Saved details you can see",
    description: "Keep personalization transparent with review and delete controls in your account.",
  },
  {
    eyebrow: "03",
    title: "Simple account controls",
    description: "Track monthly suggestions, billing, connected Macs, and account status from the web dashboard.",
  },
] as const;

const downloadPermissionRows = [
  {
    label: "Accessibility permission",
    value: "Required",
    tone: "warning",
    description: "Tab needs macOS Accessibility permission to read the text field you use and add suggestions you accept.",
  },
  {
    label: "Input Monitoring",
    value: "Guided",
    tone: "info",
    description: "Tab explains each permission before you grant it in System Settings.",
  },
] as const;

type PlanEntry = [PlanId, (typeof planQuotas)[PlanId]];
type StatusPresentation = { value: string; tone: PatternTone };

function getPlanEntries(): PlanEntry[] {
  return Object.entries(planQuotas) as PlanEntry[];
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

export function formatMonthlyPrice(monthlyPriceUsd: number): string {
  if (monthlyPriceUsd === 0) return "Free";
  return `${new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(monthlyPriceUsd)}/mo`;
}

function formatCount(count: number): string {
  return new Intl.NumberFormat(undefined).format(count);
}

function isPlanId(planId: string): planId is PlanId {
  return planId in planQuotas;
}

function formatPlanName(planId: string): string {
  if (isPlanId(planId)) return planQuotas[planId].name;
  return planId.charAt(0).toUpperCase() + planId.slice(1);
}

function planCheckoutLabel(authenticated: boolean): string {
  if (authenticated) return "Ready to choose this plan";
  return "Sign in to choose this plan";
}

function checkoutPlanHref(planId: PlanId): string {
  return `/billing/checkout?plan=${planId}`;
}

function checkoutAuthHref(planId: PlanId): string {
  const next = checkoutPlanHref(planId);
  return `/login?next=${encodeURIComponent(next)}`;
}

function checkoutHref(planId: PlanId, authenticated: boolean): string {
  if (authenticated) return checkoutPlanHref(planId);
  return checkoutAuthHref(planId);
}

function checkoutCtaLabel(planId: PlanId, planName: string): string {
  if (planId === "free") return "Start free";
  return `Choose ${planName}`;
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

function preserveAuthSearchParams(search: AuthSearch): string {
  const params = new URLSearchParams();
  if (search.device_id) params.set("device_id", search.device_id);
  if (search.callback) params.set("callback", search.callback);
  if (search.next) params.set("next", search.next);
  const query = params.toString();
  return query ? `?${query}` : "";
}

function ErrorMessage({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-destructive">{message}</p>;
}

function HandoffFields({ search }: { search: AuthSearch }) {
  return (
    <>
      {search.device_id ? <input type="hidden" name="device_id" value={search.device_id} /> : null}
      {search.callback ? <input type="hidden" name="callback" value={search.callback} /> : null}
      {search.next ? <input type="hidden" name="next" value={search.next} /> : null}
    </>
  );
}

function hasDesktopHandoff(search: AuthSearch): boolean {
  return Boolean(search.device_id || search.callback);
}

function AuthPageTitle({ children }: { children: ReactNode }) {
  return <h1 className={authTitleClassName}>{children}</h1>;
}

function PageKicker({ children }: { children: ReactNode }) {
  return <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">{children}</p>;
}

function AuthShell({
  eyebrow,
  title,
  description,
  handoff,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  handoff?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(320px,0.72fr)] lg:items-start">
      <SectionBlock className="pug-dot-grid min-h-full">
        <SurfaceHeader eyebrow={eyebrow} title={title} description={description} />
        <div className="mt-6 grid gap-3">
          <StatusRow label="Tab for Mac" value="Connected securely" tone="success" description="Sign in to connect this Mac to your Tab account." />
          <StatusRow label="Recent typing" value="Used for suggestions" tone="info" description="Sign-in does not save recent typing as a memory." />
          {handoff ? (
            <StatusRow label="Mac sign-in" value="Ready to return" tone="warning" description="After sign-in, you will return to Tab on this Mac." />
          ) : null}
        </div>
      </SectionBlock>
      <Card className="w-full">
        <CardContent className="grid gap-5 pt-5 sm:pt-6">{children}</CardContent>
      </Card>
    </section>
  );
}

export function HomePage() {
  return (
    <>
      <section className="grid gap-8 overflow-hidden rounded-[var(--radius-surface)] border border-border bg-card/88 p-[clamp(1.25rem,4vw,4rem)] shadow-[var(--tab-shadow-soft)] md:grid-cols-[minmax(0,1.08fr)_minmax(280px,0.92fr)]">
        <div className="grid content-center gap-5">
          <PageKicker>Autocomplete for your Mac</PageKicker>
          <h1 className="font-[var(--font-display)] text-[clamp(2.6rem,8vw,5.75rem)] font-black leading-[0.9] tracking-[-0.08em]">Autocomplete that works anywhere you write on your Mac.</h1>
          <p className="max-w-2xl text-[clamp(1.05rem,2vw,1.35rem)] leading-relaxed text-muted-foreground">Tab suggests the next few words in the app you are already using. Add a suggestion with Option+Tab or a click, without switching windows.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a className={buttonVariants()} href="/download">Download for macOS</a>
            <a className={buttonVariants({ variant: "secondary" })} href="/pricing">See pricing</a>
          </div>
        </div>
        <Card className="pug-dot-grid">
          <CardHeader>
            <CardTitle>Clear by default</CardTitle>
            <CardDescription>Simple controls for suggestions, saved memories, and your account.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-muted-foreground">
            {homeProofRows.map((row) => (
              <StatusRow key={row.label} {...row} />
            ))}
          </CardContent>
        </Card>
      </section>
      <section className="mt-6 grid gap-4 md:grid-cols-3">
        {homeFeatureBlocks.map((feature) => (
          <SectionBlock key={feature.eyebrow}>
            <SurfaceHeader {...feature} />
          </SectionBlock>
        ))}
      </section>
    </>
  );
}

export function PricingPage({ authenticated = false }: { authenticated?: boolean }) {
  const plans = getPlanEntries().map(([planId, plan]) => ({
    planId,
    ...plan,
  }));

  return (
    <SectionBlock className="pug-grid-surface grid gap-6">
      <SurfaceHeader
        eyebrow="Simple pricing"
        title="Pricing"
        description="Choose the plan that fits how much you write. Upgrade or downgrade whenever you need."
      />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        {plans.map((plan) => (
          <Card key={plan.planId} className="flex flex-col">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <CardTitle>{plan.name}</CardTitle>
                <Badge variant="outline">Plan</Badge>
              </div>
              <div className="font-[var(--font-display)] text-4xl font-black tracking-[-0.07em]">{formatMonthlyPrice(plan.monthlyPriceUsd)}</div>
            </CardHeader>
            <CardContent className="grid flex-1 gap-3 text-muted-foreground">
              <StatusRow
                label="Monthly suggestions"
                value={`${formatCount(plan.monthlyAutocompleteSuggestions)} / month`}
                tone="info"
                description="Suggestions included in this plan."
              />
              <StatusRow
                label="Saved memories"
                value="Included"
                tone="neutral"
                description="Review and delete saved details from the dashboard."
              />
              <p className="text-sm font-bold text-foreground">{planCheckoutLabel(authenticated)}</p>
            </CardContent>
            <CardFooter>
              <a className={buttonVariants()} href={checkoutHref(plan.planId, authenticated)}>
                {checkoutCtaLabel(plan.planId, plan.name)}
              </a>
            </CardFooter>
          </Card>
        ))}
      </div>
    </SectionBlock>
  );
}

export function LoginPage({ search = {}, error }: { search?: AuthSearch; error?: string }) {
  const signupHref = `/signup${preserveAuthSearchParams(search)}`;

  return (
    <AuthShell eyebrow="Account access" title="Sign in" description="Open your Tab account or finish connecting this Mac." handoff={hasDesktopHandoff(search)}>
      <AuthPageTitle>Sign in</AuthPageTitle>
      <form className="flex flex-col gap-4" method="post" action="/login">
        <ErrorMessage message={error} />
        <HandoffFields search={search} />
        <Label>Email<Input type="email" name="email" required autoComplete="email" /></Label>
        <Label>Password<Input type="password" name="password" required autoComplete="current-password" /></Label>
        <p><Button type="submit">Sign in</Button></p>
      </form>
      <p className="mt-4 text-muted-foreground"><a className="underline" href="/forgot-password">Forgot your password?</a></p>
      <p className="mt-2 text-muted-foreground">Need an account? <a className="underline" href={signupHref}>Create one</a>.</p>
    </AuthShell>
  );
}

export function ForgotPasswordPage({ error, sent }: { error?: string; sent?: boolean }) {
  return (
    <AuthShell eyebrow="Account recovery" title="Reset password" description="Request a secure reset link for your Tab account.">
      <AuthPageTitle>Reset password</AuthPageTitle>
      {sent ? (
        <p className="text-muted-foreground">If an account exists for that email, a password reset link is on the way.</p>
      ) : (
        <form className="flex flex-col gap-4" method="post" action="/forgot-password">
          <ErrorMessage message={error} />
          <Label>Email<Input type="email" name="email" required autoComplete="email" /></Label>
          <p><Button type="submit">Send reset link</Button></p>
        </form>
      )}
      <p className="mt-4 text-muted-foreground"><a className="underline" href="/login">Back to sign in</a>.</p>
    </AuthShell>
  );
}

export function ResetPasswordPage({ error, token }: { error?: string; token?: string }) {
  return (
    <AuthShell eyebrow="Account recovery" title="Choose a new password" description="Set a new password for your Tab account.">
      <AuthPageTitle>Choose a new password</AuthPageTitle>
      {token ? (
        <form className="flex flex-col gap-4" method="post" action="/reset-password">
          <ErrorMessage message={error} />
          <input type="hidden" name="token" value={token} />
          <Label>New password<Input type="password" name="password" required autoComplete="new-password" minLength={8} /></Label>
          <p><Button type="submit">Update password</Button></p>
        </form>
      ) : (
        <p className="text-muted-foreground">This reset link is invalid or expired. Request a new password reset link.</p>
      )}
      <p className="mt-4 text-muted-foreground"><a className="underline" href="/forgot-password">Request another link</a>.</p>
    </AuthShell>
  );
}

export function SignupPage({ search = {}, error }: { search?: AuthSearch; error?: string }) {
  const loginHref = `/login${preserveAuthSearchParams(search)}`;

  return (
    <AuthShell eyebrow="Account access" title="Create your account" description="Start Tab with an account for billing, connected Macs, monthly suggestions, and saved memories." handoff={hasDesktopHandoff(search)}>
      <AuthPageTitle>Create your account</AuthPageTitle>
      <form className="flex flex-col gap-4" method="post" action="/signup">
        <ErrorMessage message={error} />
        <HandoffFields search={search} />
        <Label>Name<Input type="text" name="name" required autoComplete="name" /></Label>
        <Label>Email<Input type="email" name="email" required autoComplete="email" /></Label>
        <Label>Password<Input type="password" name="password" required autoComplete="new-password" /></Label>
        <p><Button type="submit">Sign up</Button></p>
      </form>
      <p className="mt-4 text-muted-foreground">Already have an account? <a className="underline" href={loginHref}>Sign in</a>.</p>
    </AuthShell>
  );
}

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

function DashboardTabs({ active }: { active: DashboardSection }) {
  const items = [
    { label: "Overview", href: "/dashboard", active: active === "overview" },
    ...dashboardSections.map((section) => ({
      label: section.title,
      href: section.href,
      active: active === section.id,
    })),
  ];

  return (
    <SettingsNav items={items} className="max-w-max" aria-label="Dashboard sections" />
  );
}

function DashboardHeader({ section }: { section: DashboardSection }) {
  const title = section === "overview"
    ? "Dashboard"
    : dashboardSections.find((item) => item.id === section)?.title ?? "Dashboard";

  return (
    <div className="grid gap-4">
      <SurfaceHeader
        eyebrow="Account dashboard"
        title={title}
        description="Manage your account, monthly suggestions, billing, connected Macs, and saved memories."
        headingLevel={1}
      />
      <DashboardTabs active={section} />
    </div>
  );
}

export function DashboardPage({ data, section = "overview" }: { data?: DashboardData; section?: DashboardSection }) {
  if (!data) {
    return <DashboardPlaceholder section={section} />;
  }

  return (
    <div className="grid gap-6">
      <DashboardHeader section={section} />
      {section === "overview" ? <DashboardOverview data={data} /> : null}
      {section === "account" ? <AccountConfigCard user={data.user} /> : null}
      {section === "usage" ? <UsageBillingCard quota={data.quota} /> : null}
      {section === "devices" ? <DevicesCard devices={data.devices} /> : null}
      {section === "memories" ? <MemoriesCard memories={data.memories} /> : null}
    </div>
  );
}

function DashboardPlaceholder({ section = "overview" }: { section?: DashboardSection }) {
  return (
    <div className="grid gap-6">
      <DashboardHeader section={section} />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        {dashboardSections.map((item) => (
          <Card key={item.id}>
            <CardHeader><CardTitle>{item.title}</CardTitle></CardHeader>
            <CardContent className="grid gap-4 text-muted-foreground">
              <p>{item.description}</p>
              <p><a className={buttonVariants({ variant: "secondary" })} href={item.href}>Open {item.title}</a></p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function DashboardOverview({ data }: { data: DashboardData }) {
  const connectedDevices = data.devices.filter((device) => !device.revoked).length;
  const quotaUsed = Math.min(data.quota.usage, data.quota.quota);
  const quotaPercent = data.quota.quota > 0 ? Math.round((quotaUsed / data.quota.quota) * 100) : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
      <Card className="pug-dot-grid">
        <CardHeader>
          <CardTitle>Account at a Glance</CardTitle>
          <CardDescription>Your plan, monthly usage, connected Macs, and saved memories in one place.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <StatusRow label="Plan" value={formatPlanName(data.quota.planId)} tone="info" description="Current billing entitlement." />
            <StatusRow label="Connected Macs" value={formatCount(connectedDevices)} tone="success" description={`${formatCount(data.devices.length)} total device records.`} />
            <StatusRow label="Saved memories" value={formatCount(data.memories.length)} tone="neutral" description="Details available for personalized suggestions." />
            <StatusRow label="Account" value={emailStatus(data.user.emailVerified).value} tone={emailStatus(data.user.emailVerified).tone} description={data.user.email ?? data.user.name ?? data.user.id} />
          </div>
          <div className="grid gap-2 rounded-[var(--radius-media)] border border-border bg-muted/45 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-foreground">Monthly Suggestions</p>
              <p className="font-[var(--font-code)] text-sm tabular-nums text-muted-foreground">{formatCount(data.quota.usage)} / {formatCount(data.quota.quota)}</p>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-border" role="meter" aria-label="Monthly suggestions used" aria-valuemin={0} aria-valuemax={data.quota.quota} aria-valuenow={quotaUsed}>
              <div className="h-full rounded-full bg-foreground" style={{ width: `${quotaPercent}%` }} />
            </div>
            <p className="text-xs font-medium text-muted-foreground">Resets {formatDate(data.quota.resetAt)}</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Next Best Action</CardTitle>
          <CardDescription>Keep the account ready before your monthly suggestions run out.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-muted-foreground">
          <p>{data.quota.usage >= data.quota.quota ? "Upgrade to continue using suggestions this month." : "Review usage and billing before changing plans."}</p>
          <p><a className={buttonVariants()} href="/dashboard/usage">Review Usage & Billing</a></p>
        </CardContent>
      </Card>
    </div>
  );
}

function AccountConfigCard({ user }: { user: User }) {
  const accountName = user.email ?? user.name ?? user.id;
  const accountEmailStatus = emailStatus(user.emailVerified);

  return (
    <SectionBlock>
      <SurfaceHeader
        eyebrow="Account status"
        title="Account"
        description="You are signed in to Tab. Use this page to check your email status or sign out."
        action={<form method="post" action="/logout"><Button type="submit" variant="secondary">Sign out</Button></form>}
      />
      <div className="mt-4 grid gap-3">
        <StatusRow
          label="Signed-in account"
          value="Signed in"
          tone="success"
          description={accountName}
        />
        <StatusRow
          label="Email status"
          value={accountEmailStatus.value}
          tone={accountEmailStatus.tone}
          description="You may need to verify your email before choosing a paid plan."
        />
      </div>
    </SectionBlock>
  );
}

function UsageBillingCard({ quota }: { quota: BillingQuotaResponse["data"] }) {
  const upgradePlans = getPlanEntries().filter(([planId]) => planId !== quota.planId);
  const quotaExhausted = quota.usage >= quota.quota;
  const accountQuotaStatus = quotaStatus(quotaExhausted);
  const quotaUsed = Math.min(quota.usage, quota.quota);
  const quotaPercent = quota.quota > 0 ? Math.round((quotaUsed / quota.quota) * 100) : 0;

  return (
    <SectionBlock>
      <SurfaceHeader
        eyebrow="Monthly usage"
        title="Monthly usage"
        description={`${formatPlanName(quota.planId)} plan`}
      />
      <div className="mt-4 grid gap-3">
        <div className="grid gap-2 rounded-[var(--radius-media)] border border-border bg-muted/45 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-foreground">Quota Progress</p>
            <p className="font-[var(--font-code)] text-sm tabular-nums text-muted-foreground">{formatCount(quota.usage)} / {formatCount(quota.quota)}</p>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-border" role="meter" aria-label="Monthly suggestions used" aria-valuemin={0} aria-valuemax={quota.quota} aria-valuenow={quotaUsed}>
            <div className="h-full rounded-full bg-foreground" style={{ width: `${quotaPercent}%` }} />
          </div>
          <p className="text-xs font-medium text-muted-foreground">Resets {formatDate(quota.resetAt)}</p>
        </div>
        <StatusRow
          label="Monthly suggestions"
          value={accountQuotaStatus.value}
          tone={accountQuotaStatus.tone}
          description={`${formatCount(quota.usage)} / ${formatCount(quota.quota)} suggestions used this month`}
          meta={`Resets ${formatDate(quota.resetAt)}`}
        />
        {quotaExhausted ? (
          <div className={quotaExhaustedClassName}>
            <strong>Monthly suggestions used.</strong> You have used {formatCount(quota.usage)} of {formatCount(quota.quota)} suggestions this month. <a className="underline" href="/pricing">Upgrade to continue</a>.
          </div>
        ) : null}
        <Separator />
        <div className="grid gap-2">
          <p className="text-sm font-bold text-foreground">Billing actions</p>
          <p className="flex flex-wrap gap-2">
            {upgradePlans.map(([planId, plan]) => (
              <a key={planId} className={buttonVariants()} href={checkoutPlanHref(planId)}>
                {planActionLabel(plan.name, plan.monthlyPriceUsd)}
              </a>
            ))}
            <a className={buttonVariants({ variant: "secondary" })} href="/billing/portal">Manage billing</a>
          </p>
        </div>
      </div>
    </SectionBlock>
  );
}

function DevicesCard({ devices }: { devices: readonly DeviceListItem[] }) {
  const activeDeviceCount = devices.filter((device) => !device.revoked).length;
  const revokedDeviceCount = devices.length - activeDeviceCount;

  return (
    <SectionBlock id="devices">
      <SurfaceHeader
        eyebrow="Linked devices"
        title="Devices"
        description="Macs connected to this account. Remove access anytime."
      />
      <div className="mt-4 grid gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatusRow label="Connected" value={formatCount(activeDeviceCount)} tone="success" description="Macs that can use this account." />
          <StatusRow label="Removed" value={formatCount(revokedDeviceCount)} tone="neutral" description="Devices with access revoked." />
          <StatusRow label="Removal" value="Confirm first" tone="warning" description="Remove access if you no longer recognize a Mac." />
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
                <TableHead>Platform</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Added</TableHead>
                <TableHead>Status</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((device) => (
                <TableRow key={device.id}>
                  <TableCell className="break-all font-[var(--font-code)] text-xs">{device.deviceId}</TableCell>
                  <TableCell>{device.platform}</TableCell>
                  <TableCell>{device.appVersion}</TableCell>
                  <TableCell>{formatDate(device.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant={device.revoked ? "secondary" : "default"}>{deviceStatus(device)}</Badge>
                  </TableCell>
                  <TableCell>
                    {device.revoked ? null : (
                      <form method="post" action={`/dashboard/devices/${encodeURIComponent(device.deviceId)}/revoke`} className="grid gap-2">
                        <Label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                          <input type="checkbox" name="confirm" value={device.deviceId} required />
                          Confirm removal
                        </Label>
                        <Button type="submit" size="sm" variant="secondary">Remove access</Button>
                      </form>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </SectionBlock>
  );
}

function MemoriesCard({ memories }: { memories: readonly PersonalMemory[] }) {
  const memoryCountLabel = `${formatCount(memories.length)} ${memories.length === 1 ? "memory" : "memories"}`;
  const savedByUserCount = memories.filter((memory) => memory.createdBy === "user").length;
  const savedFromWritingCount = memories.length - savedByUserCount;

  return (
    <SectionBlock id="memories" className="overflow-hidden">
      <SurfaceHeader
        eyebrow="Saved memories"
        title="Saved Memories"
        description="Review, update, and delete the details Tab can use for personalization. Memory use still turns on or off from the Mac app settings."
      />
      <div className="mt-4 grid gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatusRow label="Saved" value={memoryCountLabel} tone="info" description="Available for personalized suggestions when enabled." />
          <StatusRow label="Saved by you" value={formatCount(savedByUserCount)} tone="success" description="Memories you added or updated manually." />
          <StatusRow label="From writing" value={formatCount(savedFromWritingCount)} tone="neutral" description="Memories learned from accepted writing." />
        </div>
        <div className="rounded-[var(--radius-card)] border border-border bg-muted/35 p-4 text-sm text-muted-foreground">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p>Saved memories can personalize suggestions when memory is enabled in the Mac app.</p>
            <Badge variant="secondary" className="w-max">Controlled on Each Mac</Badge>
          </div>
        </div>
        <details className="rounded-[var(--radius-card)] border border-border bg-background p-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--radius-control)] px-2 py-1 text-sm font-bold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            Add a Memory
            <span className="text-xs font-medium text-muted-foreground">500 Character Limit</span>
          </summary>
          <form method="post" action="/dashboard/memories/create" className="mt-3 grid gap-3">
            <Label htmlFor="memory-content">Memory content</Label>
            <textarea
              id="memory-content"
              name="content"
              maxLength={500}
              required
              rows={3}
              autoComplete="off"
              className="min-h-20 rounded-[var(--radius-media)] border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Example: I prefer concise morning status summaries…"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm">Save Memory</Button>
              <span className="text-xs font-medium text-muted-foreground">Only save details you are comfortable reusing.</span>
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
            <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-background p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="grid gap-1">
                <p className="text-sm font-bold text-foreground">Memory Library</p>
                <p id="bulk-memory-delete-guidance" className="text-sm text-muted-foreground">
                  Select rows in the table, confirm your selection, then delete the selected memories.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="w-max">{memoryCountLabel}</Badge>
                <Label className="flex items-center gap-2 rounded-[var(--radius-control)] border border-border bg-muted/35 px-3 py-2 text-xs font-bold text-muted-foreground hover:bg-muted">
                  <input
                    form={bulkDeleteMemoriesFormId}
                    type="checkbox"
                    name="confirm"
                    value="delete-selected-memories"
                    required
                    className="size-4 accent-foreground"
                  />
                  Confirm Selection
                </Label>
                <Button
                  aria-describedby="bulk-memory-delete-guidance"
                  form={bulkDeleteMemoriesFormId}
                  type="submit"
                  size="sm"
                  variant="destructive"
                >
                  Delete Selected
                </Button>
              </div>
            </div>
            <Table aria-label="Saved memories" className="min-w-[72rem]">
              <caption className="sr-only">Saved memories available for personalized suggestions</caption>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Select</TableHead>
                  <TableHead>Memory</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="min-w-72">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memories.map((memory) => (
                  <TableRow key={memory.id}>
                    <TableCell>
                      <Label className="flex size-10 items-center justify-center rounded-[var(--radius-control)] border border-border bg-muted/30 hover:bg-muted">
                        <span className="sr-only">Select memory updated {formatDate(memory.updatedAt)}</span>
                        <input
                          form={bulkDeleteMemoriesFormId}
                          type="checkbox"
                          name="memoryId"
                          value={memory.id}
                          className="size-4 accent-foreground"
                        />
                      </Label>
                    </TableCell>
                    <TableCell className="min-w-[18rem] max-w-[36rem]">
                      <p className="whitespace-pre-wrap break-words text-sm font-medium leading-relaxed text-foreground">{memory.content}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="w-max whitespace-nowrap">{memorySourceLabel(memory.createdBy)}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-[var(--font-code)] text-xs tabular-nums text-muted-foreground">
                      <MemoryDate value={memory.createdAt} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-[var(--font-code)] text-xs tabular-nums text-muted-foreground">
                      <MemoryDate value={memory.updatedAt} />
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-72 flex-wrap items-start gap-2">
                        <details className="rounded-[var(--radius-media)] border border-border bg-card/70 p-1">
                          <summary className="cursor-pointer list-none rounded-[var(--radius-control)] px-3 py-2 text-xs font-bold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                            Update
                          </summary>
                          <form method="post" action={`/dashboard/memories/${encodeURIComponent(memory.id)}/edit`} className="mt-2 grid w-full gap-2 sm:w-[min(36rem,75vw)]">
                            <Label htmlFor={`memory-${memory.id}-content`}>Memory content</Label>
                            <textarea
                              id={`memory-${memory.id}-content`}
                              name="content"
                              maxLength={500}
                              required
                              rows={3}
                              autoComplete="off"
                              className="min-h-20 rounded-[var(--radius-media)] border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:ring-2 focus-visible:ring-ring"
                              defaultValue={memory.content}
                            />
                            <div className="flex flex-wrap items-center gap-2">
                              <Button type="submit" size="sm">Update Memory</Button>
                              <a className={buttonVariants({ size: "sm", variant: "secondary" })} href="/dashboard/memories">Cancel</a>
                            </div>
                          </form>
                        </details>
                        <details className="rounded-[var(--radius-media)] border border-destructive/25 bg-card/70 p-1">
                          <summary className="cursor-pointer list-none rounded-[var(--radius-control)] px-3 py-2 text-xs font-bold text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                            Delete
                          </summary>
                          <form method="post" action={`/dashboard/memories/${encodeURIComponent(memory.id)}/delete`} className="mt-2 grid gap-2 sm:w-80">
                            <p className="rounded-[var(--radius-media)] border border-destructive/25 bg-destructive/5 p-2 text-xs text-muted-foreground">
                              <strong className="text-foreground">Delete this saved detail?</strong> This cannot be undone.
                            </p>
                            <input type="hidden" name="confirm" value="delete-memory" />
                            <Button type="submit" size="sm" variant="destructive" className="w-max">Delete Memory</Button>
                          </form>
                        </details>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </SectionBlock>
  );
}

export function DownloadPage({ latestVersion }: { latestVersion?: string }) {
  return (
    <section className="grid gap-8 overflow-hidden rounded-[var(--radius-surface)] border border-border bg-card/88 p-[clamp(1.25rem,4vw,3.5rem)] shadow-[var(--tab-shadow-soft)] md:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
      <div className="grid content-center gap-5">
        <PageKicker>Tab for Mac</PageKicker>
        <h1 className="font-[var(--font-display)] text-[clamp(2.5rem,8vw,5.75rem)] font-black leading-[0.9] tracking-[-0.08em]">Download Tab for macOS</h1>
        <p className="max-w-2xl text-[clamp(1.05rem,2vw,1.35rem)] leading-relaxed text-muted-foreground">Install Tab on your Mac and get suggestions in the apps where you already write.</p>
        <p className="mt-6"><a className={buttonVariants()} href="/download/tab.dmg">Download Tab.dmg</a></p>
        {latestVersion ? <p className="mt-4 text-sm text-muted-foreground">Version {latestVersion}</p> : null}
      </div>
      <Card className="pug-dot-grid">
        <CardHeader><CardTitle>Before you start</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-muted-foreground">
          {downloadPermissionRows.map((row) => (
            <StatusRow key={row.label} {...row} />
          ))}
          <p>Requires macOS 14 or newer.</p>
        </CardContent>
      </Card>
    </section>
  );
}

type MessagePageProps = {
  title: string;
  message: string;
  action?: { href: string; label: string };
};

export function MessagePage({ title, message, action }: MessagePageProps) {
  return (
    <Card className="max-w-[34rem]">
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4 text-muted-foreground">
        <p>{message}</p>
        {action ? (
          <p><a className={buttonVariants()} href={action.href}>{action.label}</a></p>
        ) : null}
      </CardContent>
    </Card>
  );
}
