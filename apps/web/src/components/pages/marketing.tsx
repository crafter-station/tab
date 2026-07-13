import { planCapabilities, type BillingInterval } from "@tab/billing";
import {
  buttonVariants,
} from "@tab/ui";
import { PageKicker, formatCount, formatMonthlyPrice, formatUsd } from "./shared.tsx";

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

function checkoutHref(interval: BillingInterval, authenticated: boolean): string {
  const checkout = `/billing/checkout?plan=pro&interval=${interval}`;
  return authenticated ? checkout : `/login?next=${encodeURIComponent(checkout)}`;
}

export function PricingPage({ authenticated = false }: { authenticated?: boolean }) {
  const free = planCapabilities.free;
  const pro = planCapabilities.pro;
  const comparisonRows = [
    ["Automatic Local Suggestions", `${formatCount(free.localAcceptedWordsPerDay)} Accepted Words/day`, "Unlimited Accepted Words"],
    ["Deep Complete", `${formatCount(free.deepCompletesPerMonth)} successful results/month`, `${formatCount(pro.deepCompletesPerMonth)} successful results/month`],
    ["Personal Memory", "Manage existing memories", "Continuous Memory Extraction and full controls"],
    ["Writing controls", "Default controls", "Custom writing instructions"],
    ["Local models", "Recommended supported model", "Supported model catalog"],
    ["Personal Macs", formatCount(free.personalDeviceLimit), `Up to ${formatCount(pro.personalDeviceLimit)}`],
  ] as const;

  return (
    <div className="grid gap-16 border-t border-border py-8 sm:gap-20 sm:py-12">
      <section className="grid gap-10" aria-labelledby="pricing-heading">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,0.8fr)_minmax(17.5rem,1.2fr)] sm:items-end sm:gap-12">
          <div>
            <PageKicker>Free and Pro</PageKicker>
            <h1 id="pricing-heading" className="mt-3 text-balance font-[var(--font-display)] text-4xl font-bold tracking-[-0.015em] sm:text-5xl">Local by default. Deeper when you ask.</h1>
          </div>
          <p className="max-w-[56ch] text-pretty text-lg leading-relaxed text-muted-foreground">Automatic Suggestions stay on your Mac. Deep Complete uses bounded, redacted context in the cloud only after you double-tap Option.</p>
        </div>

        <div className="grid gap-4 border-y border-border py-5 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-8">
          <p className="font-[var(--font-display)] text-2xl font-bold">Try all of Pro for 30 days.</p>
          <p className="max-w-[62ch] text-pretty leading-relaxed text-muted-foreground">Every new account gets one account-level trial with no card required. When it ends, Tab moves to Free unless you choose Pro.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <article className="flex flex-col rounded-[var(--radius-card)] border border-border bg-card p-6 sm:p-8">
            <div className="flex min-h-7 items-center justify-between gap-3">
              <h2 className="text-xl font-bold">{free.name}</h2>
              <span className="text-xs font-semibold text-muted-foreground">After your trial</span>
            </div>
            <p className="mt-2 min-h-12 text-sm leading-relaxed text-muted-foreground">Private local help and occasional Deep Complete for lighter writing.</p>
            <p className="mt-7 font-[var(--font-display)] text-4xl font-bold tracking-[-0.015em] tabular-nums">Free</p>
            <p className="mt-2 text-sm text-muted-foreground">No card or subscription required</p>
            <div className="my-6 border-t border-border" />
            <ul className="grid flex-1 gap-3 text-sm text-muted-foreground">
              <li><strong className="text-foreground">{formatCount(free.localAcceptedWordsPerDay)} Accepted Words</strong> from Local Suggestions each day</li>
              <li><strong className="text-foreground">{formatCount(free.deepCompletesPerMonth)} Deep Completes</strong> each month</li>
              <li><strong className="text-foreground">{formatCount(free.personalDeviceLimit)} personal Mac</strong> and management of existing Personal Memory</li>
            </ul>
            <p className="mt-7 text-xs font-semibold text-muted-foreground">One trial per account, even if you reinstall or connect another Mac</p>
            <p className="mt-3"><a className={buttonVariants({ variant: "secondary", className: "w-full" })} href={authenticated ? "/dashboard" : "/signup"}>{authenticated ? "Open your dashboard" : "Start 30-day Pro trial"}</a></p>
          </article>

          <article className="flex flex-col rounded-[var(--radius-card)] border border-foreground bg-foreground p-6 text-background sm:p-8">
            <div className="flex min-h-7 items-center justify-between gap-3">
              <h2 className="text-xl font-bold">{pro.name}</h2>
              <span className="rounded-full border border-background/20 px-2.5 py-1 text-[0.6875rem] font-semibold text-background/70">Best for daily use</span>
            </div>
            <p className="mt-2 min-h-12 text-sm leading-relaxed text-background/65">Unlimited local writing, more Deep Complete, and continuous personalization.</p>
            <p className="mt-7 font-[var(--font-display)] text-4xl font-bold tracking-[-0.015em] tabular-nums">{formatMonthlyPrice(pro.monthlyPriceUsd)}</p>
            <p className="mt-2 text-sm text-background/65">or {formatUsd(pro.annualPriceUsd)}/year, equal to {formatMonthlyPrice(pro.annualPriceUsd / 12)}</p>
            <div className="my-6 border-t border-background/20" />
            <ul className="grid flex-1 gap-3 text-sm text-background/75">
              <li><strong className="text-background">Unlimited Accepted Words</strong> from Local Suggestions</li>
              <li><strong className="text-background">{formatCount(pro.deepCompletesPerMonth)} Deep Completes</strong> each month</li>
              <li><strong className="text-background">Up to {formatCount(pro.personalDeviceLimit)} personal Macs</strong>, continuous Personal Memory learning, custom instructions, and model choice</li>
            </ul>
            <p className="mt-7 text-xs font-semibold text-background/65">{authenticated ? "Choose a billing interval for secure checkout" : "Sign in, then continue to secure checkout"}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <a className={buttonVariants({ variant: "secondary", className: "w-full" })} href={checkoutHref("monthly", authenticated)}>Choose monthly</a>
              <a className={buttonVariants({ variant: "secondary", className: "w-full" })} href={checkoutHref("annual", authenticated)}>Choose annual</a>
            </div>
            <p className="mt-3 text-center text-xs text-background/65">Annual saves {formatUsd(pro.monthlyPriceUsd * 12 - pro.annualPriceUsd)} compared with 12 monthly payments.</p>
          </article>
        </div>
      </section>

      <section aria-labelledby="compare-plans-heading">
        <div>
          <PageKicker>What changes after Free</PageKicker>
          <h2 id="compare-plans-heading" className="mt-3 text-balance font-[var(--font-display)] text-3xl font-bold tracking-[-0.015em] sm:text-4xl">Compare every plan feature.</h2>
        </div>
        <div className="mt-8 overflow-hidden rounded-[var(--radius-card)] border border-border">
          <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,0.8fr)] bg-muted/35 px-5 py-3 text-xs font-semibold uppercase text-muted-foreground md:grid">
            <span>Feature</span><span>Free</span><span>Pro</span>
          </div>
          {comparisonRows.map(([feature, freeValue, proValue]) => (
            <div className="grid gap-4 border-t border-border px-5 py-5 first:border-t-0 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,0.8fr)] md:first:border-t" key={feature}>
              <h3 className="font-semibold">{feature}</h3>
              <div><p className="text-xs font-semibold uppercase text-muted-foreground md:sr-only">Free</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground md:mt-0">{freeValue}</p></div>
              <div><p className="text-xs font-semibold uppercase text-muted-foreground md:sr-only">Pro</p><p className="mt-1 text-sm font-semibold leading-relaxed md:mt-0">{proValue}</p></div>
            </div>
          ))}
        </div>
        <p className="mt-5 text-sm leading-relaxed text-muted-foreground">Personal Memory remains visible, editable, exportable, and deletable on both plans. Pro pays for continuous learning, not access to your saved data.</p>
      </section>

      <section aria-labelledby="allowances-heading">
        <PageKicker>Allowances without surprises</PageKicker>
        <h2 id="allowances-heading" className="mt-3 max-w-[16ch] text-balance font-[var(--font-display)] text-3xl font-bold tracking-[-0.015em] sm:text-4xl">Tab counts value you receive.</h2>
        <div className="mt-8 grid border-y border-border md:grid-cols-3">
          <article className="border-b border-border py-6 md:border-b-0 md:border-l md:px-6 md:first:border-l-0 md:first:pl-0">
            <h3 className="font-bold">Local Suggestions</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Free counts only words you deliberately accept into your writing. Generated, ignored, dismissed, stale, empty, and failed Suggestions do not count. The allowance resets each local calendar day on your Mac.</p>
          </article>
          <article className="border-b border-border py-6 md:border-b-0 md:border-l md:px-6">
            <h3 className="font-bold">Deep Complete</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">One Deep Complete counts when your explicit request returns a Suggestion. Retries, empty responses, and failures do not count. The allowance resets each UTC calendar month.</p>
          </article>
          <article className="py-6 md:border-l md:border-border md:pl-6">
            <h3 className="font-bold">No automatic overages</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Tab does not bill for usage beyond either allowance. Reaching one limit leaves the other mode and your account controls available until that allowance resets.</p>
          </article>
        </div>
      </section>

      <section className="grid gap-8 border-y border-border py-8 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:gap-16" aria-labelledby="billing-details-heading">
        <div>
          <PageKicker>Trial and billing</PageKicker>
          <h2 id="billing-details-heading" className="mt-3 text-balance font-[var(--font-display)] text-3xl font-bold tracking-[-0.015em]">Know what happens next.</h2>
        </div>
        <div className="grid gap-5 text-sm leading-relaxed text-muted-foreground sm:grid-cols-2">
          <div><h3 className="font-bold text-foreground">Trial</h3><p className="mt-2">The 30-day Pro trial starts once for the account. It does not restart when you reinstall Tab or connect another Mac, and it cannot charge you without checkout.</p></div>
          <div><h3 className="font-bold text-foreground">Renewal</h3><p className="mt-2">Paid Pro renews on the monthly or annual interval you select. An active subscriber changing intervals continues through the billing portal.</p></div>
          <div><h3 className="font-bold text-foreground">Cancellation</h3><p className="mt-2">Cancel in the <a className="font-semibold text-foreground underline decoration-border underline-offset-4" href="/billing/portal">billing portal</a>. Pro stays active through the paid period, then your account moves to Free.</p></div>
          <div><h3 className="font-bold text-foreground">Your data</h3><p className="mt-2">Downgrading or canceling does not remove your controls to view, edit, export, or delete existing Personal Memory.</p></div>
        </div>
      </section>

      <p className="text-center text-sm leading-relaxed text-muted-foreground">Prices are shown in USD before applicable taxes. Checkout and use of Tab are subject to the <a className="font-semibold text-foreground underline decoration-border underline-offset-4" href="/terms">Terms of Service</a> and <a className="font-semibold text-foreground underline decoration-border underline-offset-4" href="/privacy">Privacy Policy</a>.</p>
    </div>
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
