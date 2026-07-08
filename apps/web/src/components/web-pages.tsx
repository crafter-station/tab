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
  Input,
  Label,
  SectionBlock,
  StatusRow,
  SurfaceHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  buttonVariants,
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

const authTitleClassName = "font-[var(--font-display)] text-4xl font-black tracking-[-0.06em]";

const homeProofRows = [
  {
    label: "Typing Context",
    value: "Private",
    tone: "success",
    description: "Writing context is handled by the Mac app and only used to prepare the next Suggestion.",
  },
  {
    label: "Personal Memory",
    value: "Account controlled",
    tone: "info",
    description: "Review and delete memories from your dashboard.",
  },
  {
    label: "Floating Suggestion Overlay",
    value: "Lightweight",
    tone: "neutral",
    description: "The overlay stays out of the way until there is something useful to accept.",
  },
] as const;

const homeFeatureBlocks = [
  {
    eyebrow: "01",
    title: "Active Application aware",
    description: "Use one native assistant across Mail, Slack, Notes, Ghostty, and the apps where you already write.",
  },
  {
    eyebrow: "02",
    title: "Personal Memory",
    description: "Keep personalization inspectable with account-level review and delete controls.",
  },
  {
    eyebrow: "03",
    title: "Usage controls",
    description: "Track quota, billing, linked devices, and account status without leaving the web control plane.",
  },
] as const;

const downloadPermissionRows = [
  {
    label: "Accessibility permission",
    value: "Required",
    tone: "warning",
    description: "Tab needs macOS Accessibility permission to show and accept inline Suggestions.",
  },
  {
    label: "Input Monitoring",
    value: "Guided",
    tone: "info",
    description: "The desktop onboarding explains each permission before you grant it.",
  },
] as const;

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

function formatPlanName(planId: string): string {
  return planQuotas[planId as PlanId]?.name ?? planId.charAt(0).toUpperCase() + planId.slice(1);
}

function checkoutAuthHref(planId: PlanId): string {
  const next = `/billing/checkout?plan=${encodeURIComponent(planId)}`;
  return `/login?next=${encodeURIComponent(next)}`;
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
          <StatusRow label="Native Autocomplete App" value="Private" tone="success" description="Tab keeps the browser entry point aligned with the Mac app handoff." />
          <StatusRow label="Typing Context" value="Local first" tone="info" description="Sign-in does not change how writing context is handled in the desktop app." />
          {handoff ? (
            <StatusRow label="Desktop handoff" value="Preserved" tone="warning" description="Device id, callback, and next fields stay attached to this form." />
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
          <PageKicker>Private Utility Grid</PageKicker>
          <h1 className="font-[var(--font-display)] text-[clamp(2.6rem,8vw,5.75rem)] font-black leading-[0.9] tracking-[-0.08em]">Native Autocomplete App for macOS.</h1>
          <p className="max-w-2xl text-[clamp(1.05rem,2vw,1.35rem)] leading-relaxed text-muted-foreground">Tab suggests the next few words inside the Active Application, then lets you accept a Suggestion with Option+Tab or a click without changing where you write.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a className={buttonVariants()} href="/download">Download for macOS</a>
            <a className={buttonVariants({ variant: "secondary" })} href="/pricing">See pricing</a>
          </div>
        </div>
        <Card className="pug-dot-grid">
          <CardHeader>
            <CardTitle>Proof-oriented by default</CardTitle>
            <CardDescription>Clear boundaries for context, memory, and Acceptance.</CardDescription>
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
  const plans = Object.entries(planQuotas).map(([planId, plan]) => ({
    planId: planId as PlanId,
    ...plan,
  }));

  return (
    <>
      <h1 className="mb-4 text-[clamp(2.5rem,8vw,5.75rem)] leading-[0.9] font-black tracking-[-0.08em]">Pricing</h1>
      <p className="max-w-2xl text-[clamp(1.05rem,2vw,1.35rem)] text-muted-foreground">Choose the plan that fits how much you write. Upgrade or downgrade at any time.</p>
      <div className="mt-6 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        {plans.map((plan) => (
          <Card key={plan.planId}>
            <CardHeader>
              <CardTitle>{plan.name}</CardTitle>
              <div className="text-3xl font-black tracking-[-0.06em]">{formatMonthlyPrice(plan.monthlyPriceUsd)}</div>
            </CardHeader>
            <CardContent className="text-muted-foreground">
              <p>{plan.monthlyAutocompleteSuggestions.toLocaleString()} autocompletes per month</p>
              <CardDescription>Personal Memory included</CardDescription>
            </CardContent>
            <CardFooter>
              <a className={buttonVariants()} href={authenticated ? `/billing/checkout?plan=${plan.planId}` : checkoutAuthHref(plan.planId)}>{plan.planId === "free" ? "Start free" : `Choose ${plan.name}`}</a>
            </CardFooter>
          </Card>
        ))}
      </div>
    </>
  );
}

export function LoginPage({ search = {}, error }: { search?: AuthSearch; error?: string }) {
  const signupHref = `/signup${preserveAuthSearchParams(search)}`;

  return (
    <AuthShell eyebrow="Account access" title="Sign in" description="Open the Tab web control plane or complete a trusted desktop handoff." handoff={hasDesktopHandoff(search)}>
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
    <AuthShell eyebrow="Account recovery" title="Reset password" description="Request a secure reset link while keeping your desktop app connection unchanged.">
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
    <AuthShell eyebrow="Account recovery" title="Choose a new password" description="Set a new password for your Tab account and return to the same web routes.">
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
    <AuthShell eyebrow="Account access" title="Create your account" description="Start Tab with a web account for quota, billing, linked devices, and Personal Memory." handoff={hasDesktopHandoff(search)}>
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

export function DashboardPage({ data }: { data?: DashboardData }) {
  if (!data) {
    return <DashboardPlaceholder />;
  }

  const upgradePlans = Object.entries(planQuotas).filter(([planId]) => planId !== data.quota.planId);
  const quotaExhausted = data.quota.usage >= data.quota.quota;

  return (
    <>
      <h1 className="mb-4 text-[clamp(2.5rem,8vw,5.75rem)] leading-[0.9] font-black tracking-[-0.08em]">Dashboard</h1>
      <p className="max-w-2xl text-[clamp(1.05rem,2vw,1.35rem)] text-muted-foreground">Manage account configuration, usage, billing, devices, permissions, and Personal Memory.</p>
      <div className="mt-6 grid gap-4">
        <Card>
          <CardHeader><CardTitle>Account configuration</CardTitle></CardHeader>
          <CardContent className="text-muted-foreground">
            <p><strong className="text-foreground">{data.user.email ?? data.user.name ?? data.user.id}</strong></p>
            <p>Identity is managed by Tab auth. Additional account settings will appear here when supported by the API.</p>
          </CardContent>
          <CardFooter>
            <form method="post" action="/logout"><Button type="submit" variant="secondary">Sign out</Button></form>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Monthly usage</CardTitle>
            <CardDescription>{formatPlanName(data.quota.planId)} plan</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-muted-foreground">
            <p>{data.quota.usage.toLocaleString()} / {data.quota.quota.toLocaleString()} autocompletes used this month</p>
            <p>Resets {formatDate(data.quota.resetAt)}</p>
            {quotaExhausted ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-950">
                <strong>Quota exhausted.</strong> You have used {data.quota.usage.toLocaleString()} of {data.quota.quota.toLocaleString()} autocompletes this month. <a className="underline" href="/pricing">Upgrade to continue</a>.
              </div>
            ) : null}
            <p className="flex flex-wrap gap-2">
              {upgradePlans.map(([planId, plan]) => (
                <a key={planId} className={buttonVariants()} href={`/billing/checkout?plan=${planId}`}>{plan.monthlyPriceUsd === 0 ? `Switch to ${plan.name}` : `Upgrade to ${plan.name}`}</a>
              ))}
              <a className={buttonVariants({ variant: "secondary" })} href="/billing/portal">Manage billing</a>
            </p>
          </CardContent>
        </Card>
        <DevicesCard devices={data.devices} />
        <MemoriesCard memories={data.memories} />
      </div>
    </>
  );
}

function DashboardPlaceholder() {
  return (
    <>
      <h1 className="mb-4 text-[clamp(2.5rem,8vw,5.75rem)] leading-[0.9] font-black tracking-[-0.08em]">Dashboard</h1>
      <p className="max-w-2xl text-[clamp(1.05rem,2vw,1.35rem)] text-muted-foreground">Manage account configuration, usage, billing, devices, permissions, and Personal Memory.</p>
      <div className="mt-6 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        <Card><CardHeader><CardTitle>Monthly usage</CardTitle></CardHeader><CardContent className="flex flex-col gap-4 text-muted-foreground"><p>Plan, quota, and reset dates load from the Tab API when you are signed in.</p><p className="flex flex-wrap gap-2"><a className={buttonVariants()} href="/billing/checkout?plan=pro">Upgrade to Pro</a><a className={buttonVariants()} href="/billing/checkout?plan=max">Upgrade to Max</a><a className={buttonVariants({ variant: "secondary" })} href="/billing/portal">Manage billing</a></p></CardContent></Card>
        <Card><CardHeader><CardTitle>Account</CardTitle></CardHeader><CardContent className="text-muted-foreground"><p>Identity and safe account settings appear here without inventing unsupported settings APIs.</p></CardContent></Card>
        <Card id="devices"><CardHeader><CardTitle>Devices</CardTitle></CardHeader><CardContent className="text-muted-foreground"><p>Linked native devices, versions, status, and revoke controls are powered by the existing device APIs.</p></CardContent></Card>
        <Card id="memories"><CardHeader><CardTitle>Personal Memory</CardTitle></CardHeader><CardContent className="text-muted-foreground"><p>Review and delete memories collected for autocomplete personalization.</p></CardContent></Card>
      </div>
    </>
  );
}

function DevicesCard({ devices }: { devices: readonly DeviceListItem[] }) {
  return (
    <Card id="devices">
      <CardHeader><CardTitle>Devices</CardTitle></CardHeader>
      <CardContent>
        {devices.length === 0 ? <p className="text-muted-foreground">No devices linked to your account.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Device</TableHead><TableHead>Platform</TableHead><TableHead>Version</TableHead><TableHead>Added</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {devices.map((device) => (
                <TableRow key={device.id}>
                  <TableCell>{device.deviceId}</TableCell>
                  <TableCell>{device.platform}</TableCell>
                  <TableCell>{device.appVersion}</TableCell>
                  <TableCell>{formatDate(device.createdAt)}</TableCell>
                  <TableCell><Badge variant={device.revoked ? "secondary" : "default"}>{device.revoked ? "Revoked" : "Active"}</Badge></TableCell>
                  <TableCell>{device.revoked ? null : <form method="post" action={`/account/devices/${encodeURIComponent(device.deviceId)}/revoke`}><Button type="submit" size="sm" variant="secondary">Revoke</Button></form>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function MemoriesCard({ memories }: { memories: readonly PersonalMemory[] }) {
  return (
    <Card id="memories">
      <CardHeader>
        <CardTitle>Personal Memory</CardTitle>
        <CardDescription>Teach, edit, and delete the facts Tab can use for personalization.</CardDescription>
      </CardHeader>
      <CardContent>
        <form method="post" action="/account/memory/create" className="mb-6 grid gap-3 rounded-lg border bg-muted/30 p-4">
          <Label htmlFor="memory-content">Teach Tab a memory</Label>
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
        {memories.length === 0 ? <p className="text-muted-foreground">No memories stored yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Content</TableHead><TableHead>Created by</TableHead><TableHead>Updated</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {memories.map((memory) => (
                <TableRow key={memory.id}>
                  <TableCell>
                    <form method="post" action={`/account/memory/${encodeURIComponent(memory.id)}/edit`} className="grid gap-2">
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
                  <TableCell>{memory.createdBy}</TableCell>
                  <TableCell>{formatDate(memory.updatedAt)}</TableCell>
                  <TableCell><form method="post" action={`/account/memory/${encodeURIComponent(memory.id)}/delete`}><Button type="submit" size="sm" variant="secondary">Delete</Button></form></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function DownloadPage({ latestVersion }: { latestVersion?: string }) {
  return (
    <section className="grid gap-8 overflow-hidden rounded-[var(--radius-surface)] border border-border bg-card/88 p-[clamp(1.25rem,4vw,3.5rem)] shadow-[var(--tab-shadow-soft)] md:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
      <div className="grid content-center gap-5">
        <PageKicker>Desktop entry point</PageKicker>
        <h1 className="font-[var(--font-display)] text-[clamp(2.5rem,8vw,5.75rem)] font-black leading-[0.9] tracking-[-0.08em]">Download Tab for macOS</h1>
        <p className="max-w-2xl text-[clamp(1.05rem,2vw,1.35rem)] leading-relaxed text-muted-foreground">Install the private Native Autocomplete App directly on your Mac and keep Suggestions in the apps where you write.</p>
        <p className="mt-6"><a className={buttonVariants()} href="/download/tab.dmg">Download Tab.dmg</a></p>
        {latestVersion ? <p className="mt-4 text-sm text-muted-foreground">Version {latestVersion}</p> : null}
      </div>
      <Card className="pug-dot-grid">
        <CardHeader><CardTitle>Before you start</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-muted-foreground">
          {downloadPermissionRows.map((row) => (
            <StatusRow key={row.label} {...row} />
          ))}
          <p>macOS 14+. Notarization and code signing are handled during release packaging.</p>
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
