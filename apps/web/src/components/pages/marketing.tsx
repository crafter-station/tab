import { planCapabilities, type PlanId } from "@tab/billing";
import {
  buttonVariants,
} from "@tab/ui";
import { PageKicker, formatMonthlyPrice } from "./shared.tsx";

export { HomePage } from "./home.tsx";

const downloadSteps = [
  {
    number: "01",
    title: "Install Tab",
    description: "Open the disk image and move Tab into Applications.",
  },
  {
    number: "02",
    title: "Grant access",
    description: "Follow the in-app guide for Accessibility and Input Monitoring.",
  },
  {
    number: "03",
    title: "Keep writing",
    description: "Tab appears only when it has a useful suggestion for the field you are in.",
  },
] as const;

type PlanEntry = [PlanId, (typeof planCapabilities)[PlanId]];

function getPlanEntries(): PlanEntry[] {
  return Object.entries(planCapabilities) as PlanEntry[];
}

function planCheckoutLabel(authenticated: boolean): string {
  if (authenticated) return "Ready to choose this plan";
  return "Sign in to choose this plan";
}

function checkoutPlanHref(planId: PlanId): string {
  return planId === "free"
    ? "/dashboard"
    : "/billing/checkout?plan=pro&interval=monthly";
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
  if (planId === "free") return "Start 30-day Pro trial";
  return `Choose ${planName}`;
}

function planDescription(planId: PlanId): string {
  if (planId === "free") return "Private local help for lighter writing.";
  return "Unlimited local writing with deeper cloud help when you ask.";
}

export function PricingPage({ authenticated = false }: { authenticated?: boolean }) {
  const plans = getPlanEntries().map(([planId, plan]) => ({
    planId,
    ...plan,
  }));

  return (
    <section className="grid gap-10 border-t border-border py-8 sm:py-12">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,0.8fr)_minmax(280px,1.2fr)] sm:items-end sm:gap-12">
        <div>
          <PageKicker>Simple pricing</PageKicker>
          <h1 className="mt-3 text-balance font-[var(--font-display)] text-4xl font-bold tracking-[-0.015em]">Local by default. Deeper when you ask.</h1>
        </div>
        <p className="max-w-[56ch] text-pretty text-lg leading-relaxed text-muted-foreground">Automatic Suggestions stay on your Mac. Double-tap Option for Deep Complete, which sends bounded, redacted context to the cloud only after that explicit action.</p>
      </div>
      <div className="grid border-y border-border md:grid-cols-2">
        {plans.map((plan) => (
          <article key={plan.planId} className={`flex flex-col border-b border-border py-7 last:border-b-0 md:border-b-0 md:border-l md:px-7 md:first:border-l-0 md:first:pl-0 md:last:pr-0 ${plan.planId === "pro" ? "bg-muted/25" : ""}`}>
            <div className="flex min-h-7 items-center justify-between gap-3">
              <h2 className="text-xl font-bold">{plan.name}</h2>
              {plan.planId === "pro" ? <span className="text-xs font-semibold text-muted-foreground">Best for daily use</span> : null}
            </div>
            <p className="mt-2 min-h-12 text-sm leading-relaxed text-muted-foreground">{planDescription(plan.planId)}</p>
            <p className="mt-7 font-[var(--font-display)] text-4xl font-bold tracking-[-0.015em] tabular-nums">{formatMonthlyPrice(plan.monthlyPriceUsd)}</p>
            <div className="my-6 border-t border-border" />
            <div className="flex-1">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Local Accepted Words</p>
              <p className="mt-2 text-2xl font-bold tabular-nums">{plan.localAcceptedWordsPerDay === null ? "Unlimited" : `${plan.localAcceptedWordsPerDay} / day`}</p>
              <ul className="mt-5 grid gap-3 text-sm text-muted-foreground">
                <li className="flex gap-2"><span className="text-foreground" aria-hidden="true">+</span><span>{plan.deepCompletesPerMonth} Deep Completes / month</span></li>
                <li className="flex gap-2"><span className="text-foreground" aria-hidden="true">+</span><span>{plan.personalDeviceLimit} personal {plan.personalDeviceLimit === 1 ? "Mac" : "Macs"}</span></li>
                <li className="flex gap-2"><span className="text-foreground" aria-hidden="true">+</span><span>{plan.continuousMemoryExtraction ? "Continuous Memory Extraction" : "Manage and export existing memories"}</span></li>
              </ul>
            </div>
            <p className="mt-7 text-xs font-semibold text-muted-foreground">{planCheckoutLabel(authenticated)}</p>
            <p className="mt-3">
              <a className={buttonVariants({ variant: plan.planId === "pro" ? "default" : "secondary", className: "w-full" })} href={checkoutHref(plan.planId, authenticated)}>
                {checkoutCtaLabel(plan.planId, plan.name)}
              </a>
            </p>
          </article>
        ))}
      </div>
      <p className="text-center text-sm text-muted-foreground">Every new account starts with 30 days of Pro, no card required. Pro is $10 monthly or $96 annually.</p>
    </section>
  );
}

export function DownloadPage({ latestVersion }: { latestVersion?: string }) {
  return (
    <section className="grid gap-12 py-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(360px,1.1fr)] lg:items-center lg:gap-16 lg:py-14">
      <div className="grid content-center gap-5">
        <PageKicker>Tab for Mac</PageKicker>
        <h1 className="max-w-[11ch] text-balance font-[var(--font-display)] text-[clamp(2.75rem,7vw,4.75rem)] font-bold leading-[0.96] tracking-[-0.03em]">Put Tab where you write.</h1>
        <p className="max-w-[52ch] text-pretty text-lg leading-relaxed text-muted-foreground">One Mac app brings suggestions to Mail, Slack, Notes, terminals, and the other text fields you already use.</p>
        <p className="mt-2"><a className={buttonVariants({ size: "lg" })} href="/download/tab.dmg">Download for macOS</a></p>
        <p className="text-sm tabular-nums text-muted-foreground">macOS 14 or newer{latestVersion ? `, version ${latestVersion}` : ""}</p>
      </div>
      <aside className="border-y border-border">
        <div className="py-5">
          <PageKicker>Three-minute setup</PageKicker>
          <h2 className="mt-3 font-[var(--font-display)] text-2xl font-bold">From download to first suggestion.</h2>
        </div>
        <ol>
          {downloadSteps.map((step) => (
            <li key={step.number} className="grid grid-cols-[2.5rem_1fr] gap-3 border-t border-border py-5">
              <span className="font-[var(--font-code)] text-xs text-muted-foreground">{step.number}</span>
              <div>
                <h3 className="font-semibold">{step.title}</h3>
                <p className="mt-1 max-w-[42ch] text-pretty leading-relaxed text-muted-foreground">{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="border-t border-border py-5 text-sm leading-relaxed text-muted-foreground">Tab explains why each macOS permission is needed before opening System Settings.</p>
      </aside>
    </section>
  );
}
