import { planQuotas, type PlanId } from "@tab/billing";
import {
  buttonVariants,
} from "@tab/ui";
import { PageKicker, formatCount, formatMonthlyPrice } from "./shared.tsx";

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

type PlanEntry = [PlanId, (typeof planQuotas)[PlanId]];

function getPlanEntries(): PlanEntry[] {
  return Object.entries(planQuotas) as PlanEntry[];
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

function planDescription(planId: PlanId): string {
  if (planId === "free") return "For trying Tab and lighter writing.";
  if (planId === "pro") return "For writing with Tab every day.";
  return "For the heaviest writing workflows.";
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
          <h1 className="mt-3 text-balance font-[var(--font-display)] text-4xl font-bold tracking-[-0.04em]">Choose by how much you write.</h1>
        </div>
        <p className="max-w-[56ch] text-pretty text-lg leading-relaxed text-muted-foreground">Every plan includes suggestions across your Mac and control over saved memories. The only difference is monthly volume.</p>
      </div>
      <div className="grid border-y border-border md:grid-cols-3">
        {plans.map((plan) => (
          <article key={plan.planId} className={`flex flex-col border-b border-border py-7 last:border-b-0 md:border-b-0 md:border-l md:px-7 md:first:border-l-0 md:first:pl-0 md:last:pr-0 ${plan.planId === "pro" ? "bg-muted/25" : ""}`}>
            <div className="flex min-h-7 items-center justify-between gap-3">
              <h2 className="text-xl font-bold">{plan.name}</h2>
              {plan.planId === "pro" ? <span className="text-xs font-semibold text-muted-foreground">Best for daily use</span> : null}
            </div>
            <p className="mt-2 min-h-12 text-sm leading-relaxed text-muted-foreground">{planDescription(plan.planId)}</p>
            <p className="mt-7 font-[var(--font-display)] text-4xl font-bold tabular-nums tracking-[-0.04em]">{formatMonthlyPrice(plan.monthlyPriceUsd)}</p>
            <div className="my-6 border-t border-border" />
            <div className="flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Monthly suggestions</p>
              <p className="mt-2 text-2xl font-bold tabular-nums">{formatCount(plan.monthlyAutocompleteSuggestions)}</p>
              <ul className="mt-5 grid gap-3 text-sm text-muted-foreground">
                <li className="flex gap-2"><span className="text-foreground" aria-hidden="true">+</span><span>Use Tab across supported Mac apps</span></li>
                <li className="flex gap-2"><span className="text-foreground" aria-hidden="true">+</span><span>Saved memories you can review and delete</span></li>
                <li className="flex gap-2"><span className="text-foreground" aria-hidden="true">+</span><span>Change plans whenever you need</span></li>
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
      <p className="text-center text-sm text-muted-foreground">No long-term contract. You can upgrade or downgrade from your account.</p>
    </section>
  );
}

export function DownloadPage({ latestVersion }: { latestVersion?: string }) {
  return (
    <section className="grid gap-12 py-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(360px,1.1fr)] lg:items-center lg:gap-16 lg:py-14">
      <div className="grid content-center gap-5">
        <PageKicker>Tab for Mac</PageKicker>
        <h1 className="max-w-[11ch] text-balance font-[var(--font-display)] text-[clamp(2.75rem,7vw,4.75rem)] font-bold leading-[0.96] tracking-[-0.045em]">Put Tab where you write.</h1>
        <p className="max-w-[52ch] text-pretty text-lg leading-relaxed text-muted-foreground">One Mac app brings suggestions to Mail, Slack, Notes, terminals, and the other text fields you already use.</p>
        <p className="mt-2"><a className={buttonVariants({ size: "lg" })} href="/download/tab.dmg">Download for macOS</a></p>
        <p className="text-sm tabular-nums text-muted-foreground">macOS 14 or newer{latestVersion ? `, version ${latestVersion}` : ""}</p>
      </div>
      <aside className="border-y border-border">
        <div className="py-5">
          <PageKicker>Three-minute setup</PageKicker>
          <h2 className="mt-3 font-[var(--font-display)] text-2xl font-bold tracking-[-0.025em]">From download to first suggestion.</h2>
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
