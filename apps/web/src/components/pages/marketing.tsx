import { planCapabilities } from "@tab/billing";
import { Button } from "@tab/ui";
import { PricingPlanGrid } from "../pricing/pricing-plan-card.tsx";
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
    title: "Allow access",
    description: "Tab explains Accessibility and Input Monitoring before opening System Settings.",
  },
  {
    number: "03",
    title: "Start writing",
    description: "Type in a supported text field and press Option+Tab when a Suggestion appears.",
  },
] as const;

export function PricingPage({ authenticated = false }: { authenticated?: boolean }) {
  const free = planCapabilities.free;
  const pro = planCapabilities.pro;
  const max = planCapabilities.max;
  const pricingPlans = [
    {
      name: "Free" as const,
      price: "$0",
      billing: "Free, with no subscription",
      badge: "For occasional use",
      description: "Local Suggestions and Deep Completes for occasional writing.",
      features: [
        <><strong className="text-foreground">{formatCount(free.localAcceptedWordsPerDay)} Accepted Words</strong> each day</>,
        <><strong className="text-foreground">{formatCount(free.deepCompletesPerMonth)} Deep Completes</strong> each month</>,
        <><strong className="text-foreground">{formatCount(free.personalDeviceLimit)} Mac</strong></>,
        <>View, edit, export, and delete existing Personal Memory</>,
      ],
      action: { kind: "link" as const, href: authenticated ? "/dashboard" : "/signup", label: authenticated ? "Go to dashboard" : "Get started free" },
      actionNote: "No credit card required.",
    },
    {
      name: "Pro" as const,
      price: formatMonthlyPrice(pro.monthlyPriceUsd),
      billing: "Billed monthly",
      badge: "Best for daily use",
      description: "Unlimited Local Suggestions, more Deep Completes, and automatic Personal Memory.",
      features: [
        <><strong className="text-background">Unlimited Accepted Words</strong></>,
        <><strong className="text-background">{formatCount(pro.deepCompletesPerMonth)} Deep Completes</strong> each month</>,
        <>Up to <strong className="text-background">{formatCount(pro.personalDeviceLimit)} Macs</strong></>,
        <>Automatic Personal Memory</>,
        <>Custom writing instructions and supported model catalog</>,
      ],
      action: { kind: "checkout" as const, plan: "pro" as const, label: authenticated ? "Choose Pro" : "Try Pro free for one month" },
      actionNote: "Payment details required. Cancel anytime.",
      featured: true,
      id: "paid-plans",
    },
    {
      name: "Max" as const,
      price: formatMonthlyPrice(max.monthlyPriceUsd),
      billing: "Billed monthly",
      badge: "Most Deep Completes",
      description: `Everything in Pro, with ${formatCount(max.deepCompletesPerMonth)} Deep Completes each month.`,
      features: [
        <><strong className="text-foreground">Unlimited Accepted Words</strong></>,
        <><strong className="text-foreground">{formatCount(max.deepCompletesPerMonth)} Deep Completes</strong> each month</>,
        <>Up to <strong className="text-foreground">{formatCount(max.personalDeviceLimit)} Macs</strong></>,
        <>Automatic Personal Memory</>,
        <>Custom writing instructions and supported model catalog</>,
      ],
      action: { kind: "checkout" as const, plan: "max" as const, label: authenticated ? "Choose Max" : "Try Max free for one month" },
      actionNote: "Payment details required. Cancel anytime.",
    },
  ];

  return (
    <div className="grid gap-20 py-10 sm:py-14">
      <section className="grid gap-10" aria-labelledby="pricing-heading">
        <div>
          <PageKicker>Simple pricing</PageKicker>
          <h1 id="pricing-heading" className="mt-4 max-w-[14ch] text-balance font-[var(--font-display)] text-[clamp(2.75rem,6vw,5.5rem)] font-bold leading-[0.94] tracking-[-0.03em]">Start free. Upgrade when you need more.</h1>
          <p className="mt-6 max-w-[52ch] text-pretty text-lg leading-relaxed text-muted-foreground">Use Tab for free with no credit card. Or try Pro or Max free for one month.</p>
          <Button asChild size="lg" className="mt-6"><a href={authenticated ? "#paid-plans" : "/signup"}>{authenticated ? "Compare plans" : "Get started free"}</a></Button>
        </div>

        <PricingPlanGrid headingLevel={2} plans={pricingPlans} />
      </section>

      <section aria-labelledby="allowances-heading">
        <PageKicker>How usage is counted</PageKicker>
        <h2 id="allowances-heading" className="mt-3 max-w-[18ch] text-balance font-[var(--font-display)] text-3xl font-bold tracking-[-0.015em] sm:text-4xl">Only completed work counts.</h2>
        <div className="mt-8 grid gap-8 md:grid-cols-3 md:gap-12">
          <article>
            <h3 className="font-bold">Suggestions</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Only words you insert count. Ignored suggestions do not.</p>
          </article>
          <article>
            <h3 className="font-bold">Deep Completes</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Only requests that return a Suggestion count.</p>
          </article>
          <article>
            <h3 className="font-bold">No automatic overages</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Reaching a limit does not create a charge or disable the other suggestion mode.</p>
          </article>
        </div>
      </section>

      <section aria-labelledby="billing-details-heading">
        <PageKicker>Good to know</PageKicker>
        <h2 id="billing-details-heading" className="mt-3 max-w-[18ch] text-balance font-[var(--font-display)] text-3xl font-bold tracking-[-0.015em] sm:text-4xl">Before you start a paid trial.</h2>
        <div className="mt-8 grid gap-8 md:grid-cols-3 md:gap-12">
          <article>
            <h3 className="font-bold">One month free</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Your trial starts at checkout. A payment method is required, but you will not be charged until the trial ends.</p>
          </article>
          <article>
            <h3 className="font-bold">Renews monthly</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">After your trial, the plan renews at its listed monthly price. Change or cancel anytime in <a className="font-semibold text-foreground underline decoration-border underline-offset-4" href="/billing/portal">billing settings</a>.</p>
          </article>
          <article>
            <h3 className="font-bold">Your memory stays yours</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">If you downgrade or cancel, you can still view, edit, export, and delete your existing Personal Memory.</p>
          </article>
        </div>
      </section>

      <p className="text-center text-sm leading-relaxed text-muted-foreground">Prices are in USD before applicable taxes. See the <a className="font-semibold text-foreground underline decoration-border underline-offset-4" href="/terms">Terms of Service</a> and <a className="font-semibold text-foreground underline decoration-border underline-offset-4" href="/privacy">Privacy Policy</a>.</p>
    </div>
  );
}

export function DownloadPage({ latestVersion }: { latestVersion?: string }) {
  return (
    <section className="grid gap-12 py-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(360px,1.1fr)] lg:items-center lg:gap-16 lg:py-16">
      <div className="grid content-center gap-5">
        <PageKicker>Tab for Mac</PageKicker>
        <h1 className="max-w-[11ch] text-balance font-[var(--font-display)] text-[clamp(2.75rem,7vw,4.75rem)] font-bold leading-[0.96] tracking-[-0.03em]">Put Tab where you write.</h1>
        <p className="max-w-[52ch] text-pretty text-lg leading-relaxed text-muted-foreground">Get suggestions in supported text fields across Mail, Slack, Notes, terminals, and more.</p>
        <p className="mt-2"><Button asChild size="lg"><a href="/download/tab.dmg">Download for Mac</a></Button></p>
        {latestVersion ? <p className="text-sm tabular-nums text-muted-foreground">Version {latestVersion}</p> : null}
      </div>
      <aside className="rounded-[var(--radius-surface)] bg-muted/35 p-6 sm:p-8">
        <PageKicker>Setup</PageKicker>
        <h2 className="mt-3 font-[var(--font-display)] text-2xl font-bold">From download to first Suggestion.</h2>
        <ol className="mt-8 grid gap-7">
          {downloadSteps.map((step) => (
            <li key={step.number} className="grid grid-cols-[2.5rem_1fr] gap-3">
              <span className="font-[var(--font-code)] text-xs text-muted-foreground">{step.number}</span>
              <div>
                <h3 className="font-semibold">{step.title}</h3>
                <p className="mt-1 max-w-[42ch] text-pretty leading-relaxed text-muted-foreground">{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </aside>
    </section>
  );
}
