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
  const date = new Date(iso);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatMonthlyPrice(monthlyPriceUsd: number): string {
  return monthlyPriceUsd === 0 ? "Free" : `$${monthlyPriceUsd}/mo`;
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
                value={`${plan.monthlyAutocompleteSuggestions.toLocaleString()} / month`}
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
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Dashboard sections">
      <a className={buttonVariants({ variant: active === "overview" ? "default" : "secondary" })} href="/dashboard">Overview</a>
      {dashboardSections.map((section) => (
        <a key={section.id} className={buttonVariants({ variant: active === section.id ? "default" : "secondary" })} href={section.href}>
          {section.title}
        </a>
      ))}
    </nav>
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
  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
      {dashboardSections.map((item) => (
        <Card key={item.id}>
          <CardHeader>
            <CardTitle>{item.title}</CardTitle>
            <CardDescription>{item.description}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-muted-foreground">
            {item.id === "account" ? <p>{data.user.email ?? data.user.name ?? data.user.id}</p> : null}
            {item.id === "usage" ? <p>{data.quota.usage.toLocaleString()} / {data.quota.quota.toLocaleString()} suggestions used</p> : null}
            {item.id === "devices" ? <p>{data.devices.length.toLocaleString()} connected Macs</p> : null}
            {item.id === "memories" ? <p>{data.memories.length.toLocaleString()} saved memories</p> : null}
            <p><a className={buttonVariants({ variant: "secondary" })} href={item.href}>Open {item.title}</a></p>
          </CardContent>
        </Card>
      ))}
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

  return (
    <SectionBlock>
      <SurfaceHeader
        eyebrow="Monthly usage"
        title="Monthly usage"
        description={`${formatPlanName(quota.planId)} plan`}
      />
      <div className="mt-4 grid gap-3">
        <StatusRow
          label="Monthly suggestions"
          value={accountQuotaStatus.value}
          tone={accountQuotaStatus.tone}
          description={`${quota.usage.toLocaleString()} / ${quota.quota.toLocaleString()} suggestions used this month`}
          meta={`Resets ${formatDate(quota.resetAt)}`}
        />
        {quotaExhausted ? (
          <div className={quotaExhaustedClassName}>
            <strong>Monthly suggestions used.</strong> You have used {quota.usage.toLocaleString()} of {quota.quota.toLocaleString()} suggestions this month. <a className="underline" href="/pricing">Upgrade to continue</a>.
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
  return (
    <SectionBlock id="devices">
      <SurfaceHeader
        eyebrow="Linked devices"
        title="Devices"
        description="Macs connected to this account. Remove access anytime."
      />
      <div className="mt-4">
        {devices.length === 0 ? (
          <EmptyState
            title="No linked devices"
            description="No Macs are connected yet. Sign in from the Mac app to connect one."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Added</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((device) => (
                <TableRow key={device.id}>
                  <TableCell>{device.deviceId}</TableCell>
                  <TableCell>{device.platform}</TableCell>
                  <TableCell>{device.appVersion}</TableCell>
                  <TableCell>{formatDate(device.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant={device.revoked ? "secondary" : "default"}>{deviceStatus(device)}</Badge>
                  </TableCell>
                  <TableCell>
                    {device.revoked ? null : (
                      <form method="post" action={`/dashboard/devices/${encodeURIComponent(device.deviceId)}/revoke`}>
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
  return (
    <SectionBlock id="memories">
      <SurfaceHeader
        eyebrow="Saved memories"
        title="Saved memories"
        description="Add, edit, and delete saved details. Turn memory use on or off from the Mac app settings."
      />
      <div className="mt-4">
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Use saved memories in suggestions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>
              Saved memories can personalize suggestions when memory is enabled in the Mac app.
            </p>
            <Badge variant="secondary">Controlled on each Mac</Badge>
          </CardContent>
        </Card>
        <form method="post" action="/dashboard/memories/create" className="mb-6 grid gap-3 rounded-lg border bg-muted/30 p-4">
          <Label htmlFor="memory-content">Add a saved memory</Label>
          <textarea
            id="memory-content"
            name="content"
            maxLength={500}
            required
            rows={3}
            className="min-h-24 rounded-md border bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Example: I prefer concise morning status summaries."
          />
          <p><Button type="submit">Save memory</Button></p>
        </form>
        {memories.length === 0 ? (
          <EmptyState
            title="No saved memories yet"
            description="Add a saved memory when you want Tab to personalize suggestions."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Content</TableHead>
                <TableHead>Created by</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {memories.map((memory) => (
                <TableRow key={memory.id}>
                  <TableCell>
                    <form method="post" action={`/dashboard/memories/${encodeURIComponent(memory.id)}/edit`} className="grid gap-2">
                      <textarea
                        name="content"
                        maxLength={500}
                        required
                        rows={2}
                        className="min-h-20 rounded-md border bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        defaultValue={memory.content}
                      />
                      <p><Button type="submit" size="sm" variant="secondary">Save edit</Button></p>
                    </form>
                  </TableCell>
                  <TableCell><Badge variant="outline">{memorySourceLabel(memory.createdBy)}</Badge></TableCell>
                  <TableCell>{formatDate(memory.updatedAt)}</TableCell>
                  <TableCell>
                    <form method="post" action={`/dashboard/memories/${encodeURIComponent(memory.id)}/delete`}>
                      <Button type="submit" size="sm" variant="destructive">Delete memory</Button>
                    </form>
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
