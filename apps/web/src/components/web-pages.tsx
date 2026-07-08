import { planQuotas, type PlanId } from "@tabb/billing";
import type {
  BillingQuotaResponse,
  DeviceListItem,
  PersonalMemory,
} from "@tabb/contracts";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  buttonVariants,
} from "@tabb/ui";

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

export function HomePage() {
  return (
    <>
      <section className="grid gap-8 overflow-hidden rounded-[2rem] border bg-[radial-gradient(circle_at_85%_20%,#e4ff80_0,transparent_30%),linear-gradient(135deg,#f7f7f2,#e7ded0)] p-[clamp(1.25rem,4vw,4rem)] md:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.9fr)]">
        <div>
          <p className="text-muted-foreground">Native autocomplete for macOS</p>
          <h1 className="mb-4 text-[clamp(2.5rem,8vw,5.75rem)] leading-[0.9] font-black tracking-[-0.08em]">Write faster without changing where you write.</h1>
          <p className="max-w-2xl text-[clamp(1.05rem,2vw,1.35rem)] text-muted-foreground">Tabb suggests the next few words while you type in Mail, Slack, Notes, Ghostty, and everywhere else you write.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a className={buttonVariants()} href="/download">Download for macOS</a>
            <a className={buttonVariants({ variant: "secondary" })} href="/pricing">See pricing</a>
          </div>
        </div>
        <Card>
          <CardHeader><CardTitle>Built for trust</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3 text-muted-foreground">
            <p>Your typing context stays on your Mac. Personal Memory is stored in your account and visible only to you.</p>
            <p>Accept suggestions with Option+Tab or a click when the lightweight overlay appears.</p>
          </CardContent>
        </Card>
      </section>
      <section className="mt-6 grid gap-4 md:grid-cols-3">
        <Card><CardHeader><CardTitle>Works everywhere</CardTitle><CardDescription>Use one native assistant across the apps where you already write.</CardDescription></CardHeader></Card>
        <Card><CardHeader><CardTitle>Personal Memory</CardTitle><CardDescription>Review and delete stored memories from your account dashboard.</CardDescription></CardHeader></Card>
        <Card><CardHeader><CardTitle>Usage controls</CardTitle><CardDescription>Track quota, billing, linked devices, and account status in one place.</CardDescription></CardHeader></Card>
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
    <Card className="max-w-[34rem]">
      <CardContent className="pt-6">
        <h1 className="mb-6 text-4xl font-black tracking-[-0.06em]">Sign in</h1>
        <form className="flex flex-col gap-4" method="post" action="/login">
          <ErrorMessage message={error} />
          <HandoffFields search={search} />
          <Label>Email<Input type="email" name="email" required autoComplete="email" /></Label>
          <Label>Password<Input type="password" name="password" required autoComplete="current-password" /></Label>
          <p><Button type="submit">Sign in</Button></p>
        </form>
        <p className="mt-4 text-muted-foreground"><a className="underline" href="/forgot-password">Forgot your password?</a></p>
        <p className="mt-2 text-muted-foreground">Need an account? <a className="underline" href={signupHref}>Create one</a>.</p>
      </CardContent>
    </Card>
  );
}

export function ForgotPasswordPage({ error, sent }: { error?: string; sent?: boolean }) {
  return (
    <Card className="max-w-[34rem]">
      <CardContent className="pt-6">
        <h1 className="mb-6 text-4xl font-black tracking-[-0.06em]">Reset password</h1>
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
      </CardContent>
    </Card>
  );
}

export function ResetPasswordPage({ error, token }: { error?: string; token?: string }) {
  return (
    <Card className="max-w-[34rem]">
      <CardContent className="pt-6">
        <h1 className="mb-6 text-4xl font-black tracking-[-0.06em]">Choose a new password</h1>
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
      </CardContent>
    </Card>
  );
}

export function SignupPage({ search = {}, error }: { search?: AuthSearch; error?: string }) {
  const loginHref = `/login${preserveAuthSearchParams(search)}`;

  return (
    <Card className="max-w-[34rem]">
      <CardContent className="pt-6">
        <h1 className="mb-6 text-4xl font-black tracking-[-0.06em]">Create your account</h1>
        <form className="flex flex-col gap-4" method="post" action="/signup">
          <ErrorMessage message={error} />
          <HandoffFields search={search} />
          <Label>Name<Input type="text" name="name" required autoComplete="name" /></Label>
          <Label>Email<Input type="email" name="email" required autoComplete="email" /></Label>
          <Label>Password<Input type="password" name="password" required autoComplete="new-password" /></Label>
          <p><Button type="submit">Sign up</Button></p>
        </form>
        <p className="mt-4 text-muted-foreground">Already have an account? <a className="underline" href={loginHref}>Sign in</a>.</p>
      </CardContent>
    </Card>
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
            <p>Identity is managed by Tabb auth. Additional account settings will appear here when supported by the API.</p>
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
        <Card><CardHeader><CardTitle>Monthly usage</CardTitle></CardHeader><CardContent className="flex flex-col gap-4 text-muted-foreground"><p>Plan, quota, and reset dates load from the Tabb API when you are signed in.</p><p className="flex flex-wrap gap-2"><a className={buttonVariants()} href="/billing/checkout?plan=pro">Upgrade to Pro</a><a className={buttonVariants()} href="/billing/checkout?plan=max">Upgrade to Max</a><a className={buttonVariants({ variant: "secondary" })} href="/billing/portal">Manage billing</a></p></CardContent></Card>
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
        <CardDescription>Teach, edit, and delete the facts Tabb can use for personalization.</CardDescription>
      </CardHeader>
      <CardContent>
        <form method="post" action="/account/memory/create" className="mb-6 grid gap-3 rounded-lg border bg-muted/30 p-4">
          <Label htmlFor="memory-content">Teach Tabb a memory</Label>
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
    <section className="grid gap-8 overflow-hidden rounded-[2rem] border bg-[radial-gradient(circle_at_85%_20%,#ffcf70_0,transparent_28%),linear-gradient(135deg,#fff6df,#efe0c4)] p-[clamp(1.25rem,4vw,3.5rem)] md:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.9fr)]">
      <div>
        <h1 className="mb-4 text-[clamp(2.5rem,8vw,5.75rem)] leading-[0.9] font-black tracking-[-0.08em]">Download Tabb for macOS</h1>
        <p className="max-w-2xl text-[clamp(1.05rem,2vw,1.35rem)] text-muted-foreground">Install the native autocomplete app directly on your Mac.</p>
        <p className="mt-6"><a className={buttonVariants()} href="/download/tabb.dmg">Download Tabb.dmg</a></p>
        {latestVersion ? <p className="mt-4 text-sm text-muted-foreground">Version {latestVersion}</p> : null}
      </div>
      <Card>
        <CardHeader><CardTitle>Before you start</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3 text-muted-foreground">
          <p>Tabb requires macOS Accessibility permission to show and accept inline suggestions.</p>
          <p>macOS 14+. Notarization and code signing are handled during release packaging.</p>
        </CardContent>
      </Card>
    </section>
  );
}

export function MessagePage({
  title,
  message,
  actionHref,
  actionLabel,
}: {
  title: string;
  message: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <Card className="max-w-[34rem]">
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="text-muted-foreground">
        <p>{message}</p>
        {actionHref && actionLabel ? (
          <p className="mt-6">
            <a className={buttonVariants()} href={actionHref}>{actionLabel}</a>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
