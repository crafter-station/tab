import { planCapabilities } from "@tab/billing";
import { Check, CaretDown } from "@phosphor-icons/react";
import { buttonVariants } from "@tab/ui";
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
  const max = {
    ...pro,
    name: "Max",
    monthlyPriceUsd: 20,
    deepCompletesPerMonth: 1_000,
  };

  return (
    <div className="grid gap-20 py-10 sm:py-14">
      <section className="grid gap-10" aria-labelledby="pricing-heading">
        <div>
          <PageKicker>Simple pricing</PageKicker>
          <h1 id="pricing-heading" className="mt-4 max-w-[14ch] text-balance font-[var(--font-display)] text-[clamp(2.75rem,6vw,5.5rem)] font-bold leading-[0.94] tracking-[-0.03em]">Your first month of Pro or Max is free.</h1>
          <p className="mt-6 max-w-[52ch] text-pretty text-lg leading-relaxed text-muted-foreground">Choose a paid plan and complete secure Polar checkout. You will not be charged until the one-month trial ends.</p>
          <a className={buttonVariants({ size: "lg", className: "mt-6" })} href={authenticated ? "#paid-plans" : "/signup"}>{authenticated ? "Choose a plan" : "Create an account"}</a>
        </div>

        <div className="grid items-stretch gap-4 lg:grid-cols-3" data-pricing-grid>
          <article className="flex h-full flex-col rounded-[var(--radius-card)] border border-border bg-card p-6 sm:p-8" data-pricing-plan="free">
            <div className="flex min-h-7 items-center justify-between gap-3">
              <h2 className="text-2xl font-bold">Free</h2>
              <span className="text-xs font-semibold text-muted-foreground">No subscription</span>
            </div>
            <p className="mt-3 min-h-12 text-sm leading-relaxed text-muted-foreground">Private local help and occasional Deep Complete for lighter writing.</p>
            <p className="mt-7 font-[var(--font-display)] text-5xl font-bold tracking-[-0.02em] tabular-nums">$0</p>
            <p className="mt-2 min-h-10 text-sm text-muted-foreground">No card or subscription required</p>
            <ul className="mt-7 grid flex-1 gap-3 text-sm leading-relaxed text-muted-foreground">
              <li className="flex gap-2"><Check className="mt-1 shrink-0 text-foreground" aria-hidden="true" /> <span><strong className="text-foreground">{formatCount(free.localAcceptedWordsPerDay)} Accepted Words</strong> from Local Suggestions each day</span></li>
              <li className="flex gap-2"><Check className="mt-1 shrink-0 text-foreground" aria-hidden="true" /> <span><strong className="text-foreground">{formatCount(free.deepCompletesPerMonth)} Deep Completes</strong> each month</span></li>
              <li className="flex gap-2"><Check className="mt-1 shrink-0 text-foreground" aria-hidden="true" /> <span><strong className="text-foreground">{formatCount(free.personalDeviceLimit)} Mac</strong></span></li>
              <li className="flex gap-2"><Check className="mt-1 shrink-0 text-foreground" aria-hidden="true" /> <span>View, edit, export, and delete existing Personal Memory</span></li>
            </ul>
            <div className="mt-8 grid gap-3">
              <p className="text-xs font-semibold text-muted-foreground">No billing details</p>
              <div className="flex h-11 items-center rounded-[var(--radius-control)] border border-border bg-muted/35 px-3 text-sm font-semibold">Free is available without checkout</div>
              <a className={buttonVariants({ variant: "secondary", size: "lg", className: "w-full" })} href={authenticated ? "/dashboard" : "/signup"}>{authenticated ? "Open dashboard" : "Create a Free account"}</a>
            </div>
            <p className="mt-3 text-center text-xs text-muted-foreground">No charge unless you choose a paid plan.</p>
          </article>

          <article id="paid-plans" className="flex h-full scroll-mt-24 flex-col rounded-[var(--radius-card)] border border-foreground bg-foreground p-6 text-background sm:p-8" data-pricing-plan="pro">
            <div className="flex min-h-7 items-center justify-between gap-3">
              <h2 className="text-2xl font-bold">Pro</h2>
              <span className="rounded-full border border-background/20 px-2.5 py-1 text-[0.6875rem] font-semibold text-background/75">Best for daily use</span>
            </div>
            <p className="mt-3 min-h-12 text-sm leading-relaxed text-background/65">Unlimited local writing, more Deep Complete, and continuous personalization.</p>
            <p className="mt-7 font-[var(--font-display)] text-5xl font-bold tracking-[-0.02em] tabular-nums">{formatMonthlyPrice(pro.monthlyPriceUsd)}</p>
            <p className="mt-2 min-h-10 text-sm text-background/65">Billed monthly</p>
            <ul className="mt-7 grid flex-1 gap-3 text-sm leading-relaxed text-background/80">
              <li className="flex gap-2"><Check className="mt-1 shrink-0 text-background" aria-hidden="true" /> <span><strong className="text-background">Unlimited Accepted Words</strong> from Local Suggestions</span></li>
              <li className="flex gap-2"><Check className="mt-1 shrink-0 text-background" aria-hidden="true" /> <span><strong className="text-background">{formatCount(pro.deepCompletesPerMonth)} Deep Completes</strong> each month</span></li>
              <li className="flex gap-2"><Check className="mt-1 shrink-0 text-background" aria-hidden="true" /> <span>Up to <strong className="text-background">{formatCount(pro.personalDeviceLimit)} Macs</strong></span></li>
              <li className="flex gap-2"><Check className="mt-1 shrink-0 text-background" aria-hidden="true" /> <span>Continuous Memory Extraction</span></li>
              <li className="flex gap-2"><Check className="mt-1 shrink-0 text-background" aria-hidden="true" /> <span>Custom writing instructions and supported model catalog</span></li>
            </ul>
            <form action="/billing/checkout" method="get" className="mt-8 grid gap-3">
              <input type="hidden" name="plan" value="pro" />
              <button className={buttonVariants({ variant: "secondary", size: "lg", className: "w-full" })} type="submit">Start Pro with one month free</button>
            </form>
            <p className="mt-3 text-center text-xs text-background/70">{authenticated ? "Payment details required. No charge today." : "Sign in, then continue to secure checkout."}</p>
          </article>

          <article className="flex h-full flex-col rounded-[var(--radius-card)] border border-border bg-card p-6 sm:p-8" data-pricing-plan="max">
            <div className="flex min-h-7 items-center justify-between gap-3">
              <h2 className="text-2xl font-bold">Max</h2>
              <span className="text-xs font-semibold text-muted-foreground">Most Deep Completes</span>
            </div>
            <p className="mt-3 min-h-12 text-sm leading-relaxed text-muted-foreground">The same complete toolkit as Pro, with more Deep Complete capacity.</p>
            <p className="mt-7 font-[var(--font-display)] text-5xl font-bold tracking-[-0.02em] tabular-nums">{formatMonthlyPrice(max.monthlyPriceUsd)}</p>
            <p className="mt-2 min-h-10 text-sm text-muted-foreground">Billed monthly</p>
            <ul className="mt-7 grid flex-1 gap-3 text-sm leading-relaxed text-muted-foreground">
              <li className="flex gap-2"><Check className="mt-1 shrink-0 text-foreground" aria-hidden="true" /> <span><strong className="text-foreground">Unlimited Accepted Words</strong> from Local Suggestions</span></li>
              <li className="flex gap-2"><Check className="mt-1 shrink-0 text-foreground" aria-hidden="true" /> <span><strong className="text-foreground">{formatCount(max.deepCompletesPerMonth)} Deep Completes</strong> each month</span></li>
              <li className="flex gap-2"><Check className="mt-1 shrink-0 text-foreground" aria-hidden="true" /> <span>Up to <strong className="text-foreground">{formatCount(max.personalDeviceLimit)} Macs</strong></span></li>
              <li className="flex gap-2"><Check className="mt-1 shrink-0 text-foreground" aria-hidden="true" /> <span>Continuous Memory Extraction</span></li>
              <li className="flex gap-2"><Check className="mt-1 shrink-0 text-foreground" aria-hidden="true" /> <span>Custom writing instructions and supported model catalog</span></li>
            </ul>
            <form action="/billing/checkout" method="get" className="mt-8 grid gap-3">
              <input type="hidden" name="plan" value="max" />
              <button className={buttonVariants({ variant: "secondary", size: "lg", className: "w-full" })} type="submit">Start Max with one month free</button>
            </form>
            <p className="mt-3 text-center text-xs text-muted-foreground">{authenticated ? "Payment details required. No charge today." : "Sign in, then continue to secure checkout."}</p>
          </article>
        </div>
      </section>

      <section aria-labelledby="allowances-heading">
        <PageKicker>How usage is counted</PageKicker>
        <h2 id="allowances-heading" className="mt-3 max-w-[18ch] text-balance font-[var(--font-display)] text-3xl font-bold tracking-[-0.015em] sm:text-4xl">Only completed work counts.</h2>
        <div className="mt-8 grid gap-8 md:grid-cols-3 md:gap-12">
          <article>
            <h3 className="font-bold">Local Suggestions</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Free counts only words you insert. Ignored, dismissed, empty, stale, and failed Suggestions do not count.</p>
          </article>
          <article>
            <h3 className="font-bold">Deep Complete</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">One request counts only when it returns a Suggestion. Retries, empty responses, and failures do not count.</p>
          </article>
          <article>
            <h3 className="font-bold">No automatic overages</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Reaching a limit does not create a charge or disable the other suggestion mode.</p>
          </article>
        </div>
      </section>

      <details className="marketing-detail rounded-[var(--radius-card)] bg-muted/35 p-5 sm:p-6">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Trial, renewal, and cancellation details
          <CaretDown className="tab-disclosure-chevron shrink-0" aria-hidden="true" />
        </summary>
        <div className="tab-disclosure-panel mt-6 grid gap-6 text-sm leading-relaxed text-muted-foreground sm:grid-cols-3">
          <div><h3 className="font-bold text-foreground">Trial</h3><p className="mt-2">Polar starts the one-month trial at paid-plan checkout, collects payment details, and prevents repeat trial redemption.</p></div>
          <div><h3 className="font-bold text-foreground">Paid plans</h3><p className="mt-2">Paid plans renew monthly. Cancel in the <a className="font-semibold text-foreground underline decoration-border underline-offset-4" href="/billing/portal">billing portal</a>.</p></div>
          <div><h3 className="font-bold text-foreground">Personal Memory</h3><p className="mt-2">Downgrading does not remove your controls to view, edit, export, or delete existing Personal Memory.</p></div>
        </div>
      </details>

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
        <p className="mt-2"><a className={buttonVariants({ size: "lg" })} href="/download/tab.dmg">Download for Mac</a></p>
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
