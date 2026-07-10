import {
  ArrowClockwise,
  ArrowRight,
  ArrowUpRight,
  Brain,
  Check,
  CheckCircle,
  Command,
  DownloadSimple,
  Eye,
  Keyboard,
  Lightning,
  LockKey,
  Plus,
  ShieldCheck,
  Sparkle,
} from "@phosphor-icons/react";
import { planQuotas } from "@tab/billing";
import { buttonVariants } from "@tab/ui";
import { PageKicker, formatCount, formatMonthlyPrice } from "./shared.tsx";

const appLogos = [
  { name: "Gmail", src: "/logos/gmail.svg" },
  { name: "Slack", src: "/logos/slack.svg" },
  { name: "Notion", src: "/logos/notion.svg" },
  { name: "Linear", src: "/logos/linear.svg" },
  { name: "Ghostty", src: "/logos/ghostty.svg" },
  { name: "Messages", src: "/logos/messages.svg" },
] as const;

const benefits = [
  {
    icon: Lightning,
    title: "Stay in the sentence",
    description: "Finish routine phrases without reaching for another app, prompt box, or copy-and-paste loop.",
  },
  {
    icon: Eye,
    title: "See it before it lands",
    description: "Suggestions appear separately from your writing. Nothing is inserted until you accept it.",
  },
  {
    icon: Brain,
    title: "Make it sound like you",
    description: "Personal Memory keeps useful details visible, editable, and deletable from your account.",
  },
] as const;

const steps = [
  {
    number: "01",
    title: "Write as usual",
    description: "Tab watches for a useful moment in supported text fields while your active app keeps focus.",
  },
  {
    number: "02",
    title: "Preview the next words",
    description: "A quiet Floating Suggestion Overlay shows a short continuation without changing your draft.",
  },
  {
    number: "03",
    title: "Accept or ignore",
    description: "Press Option+Tab to add it. Keep typing to dismiss it. You stay in control either way.",
  },
] as const;

const useCases = [
  {
    context: "Follow-up email",
    lead: "Would Thursday morning",
    suggestion: "work for a quick review?",
    app: "Mail",
  },
  {
    context: "Team update",
    lead: "The new onboarding flow is ready",
    suggestion: "for a final pass before we ship.",
    app: "Slack",
  },
  {
    context: "Project notes",
    lead: "Before launch, remember to",
    suggestion: "update the release checklist.",
    app: "Notes",
  },
] as const;

const faqs = [
  {
    question: "Does Tab type anything without me?",
    answer: "No. A suggestion stays separate from your writing until you deliberately accept it with Option+Tab. If you keep typing, Tab gets out of the way.",
  },
  {
    question: "Where does Tab work?",
    answer: "Tab is built for standard text fields across macOS apps, including everyday writing surfaces such as Mail, Slack, Notes, and terminals. Some custom editors may behave differently.",
  },
  {
    question: "What does Personal Memory save?",
    answer: "Personal Memory stores useful facts that can make suggestions more relevant. Those memories are listed in your dashboard, where you can add, edit, or delete them.",
  },
  {
    question: "Can I try it before paying?",
    answer: `Yes. The Free plan includes ${formatCount(planQuotas.free.monthlyAutocompleteSuggestions)} suggestions each month. Upgrade only when you need more volume.`,
  },
  {
    question: "What Mac do I need?",
    answer: "Tab requires macOS 14 or newer. Setup guides you through the Accessibility and Input Monitoring permissions it needs to show and insert suggestions.",
  },
] as const;

function DemoScene({
  name,
  children,
}: {
  name: "mail" | "slack" | "notes";
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-[19rem] content-between gap-8 p-5 sm:min-h-[22rem] sm:p-7" data-demo-scene={name} id={`demo-panel-${name}`} role="tabpanel" aria-labelledby={`demo-tab-${name}`}>
      {children}
      <button className="tab-demo-overlay flex w-full cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-media)] border border-foreground/15 bg-foreground px-3 py-2.5 text-left text-background shadow-[0_16px_40px_rgba(0,0,0,0.18)] transition-[background-color,border-color,transform] duration-200 ease-[var(--tab-ease-out)] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card sm:px-4" type="button" data-demo-accept aria-label="Accept this suggestion with Option plus Tab">
        <div className="flex min-w-0 items-center gap-2.5">
          <Sparkle className="shrink-0" aria-hidden="true" />
          <span className="tab-demo-ready-label truncate text-sm font-medium">Suggestion ready</span>
          <span className="tab-demo-accepted-label hidden truncate text-sm font-medium">Suggestion added</span>
        </div>
        <kbd className="shrink-0 rounded-[var(--radius-control)] border border-background/25 bg-background/10 px-2 py-1 font-[var(--font-code)] text-[0.6875rem] font-semibold">Option + Tab</kbd>
      </button>
    </div>
  );
}

function AutocompleteDemo() {
  return (
    <div className="tab-demo overflow-hidden rounded-[calc(var(--radius-card)+0.35rem)] border border-border bg-card text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" data-tab-demo data-active="mail" data-accepted="false" aria-label="Interactive Tab autocomplete demonstration" tabIndex={0}>
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-3 py-2.5 sm:px-4">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-foreground/20" />
          <span className="size-2.5 rounded-full bg-foreground/[0.12]" />
          <span className="size-2.5 rounded-full bg-foreground/[0.08]" />
        </div>
        <p className="text-xs font-semibold text-muted-foreground">Live product example</p>
        <button className="inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-control)] px-2 py-1 text-xs font-semibold text-muted-foreground transition-[color,transform] duration-150 ease-[var(--tab-ease-out)] hover:text-foreground active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" type="button" data-demo-replay>
          <ArrowClockwise aria-hidden="true" />
          Replay
        </button>
      </div>
      <div className="flex gap-2 border-b border-border p-3" role="tablist" aria-label="Choose an app example">
        {(["mail", "slack", "notes"] as const).map((app, index) => (
          <button className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-border bg-background px-3 py-1.5 text-xs font-semibold capitalize transition-[background-color,border-color,color,transform] duration-150 ease-[var(--tab-ease-out)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-demo-target={app} id={`demo-tab-${app}`} key={app} type="button" role="tab" aria-controls={`demo-panel-${app}`} aria-selected={index === 0}>
            <span className="grid size-5 place-items-center rounded-sm bg-white" aria-hidden="true"><img className="size-3" src={app === "slack" ? "/logos/slack.svg" : "/logos/apple.svg"} alt="" /></span>
            {app}
          </button>
        ))}
      </div>
      <div className="bg-card" aria-live="polite">
        <DemoScene name="mail">
          <div>
            <div className="grid gap-2 border-b border-border pb-4 text-sm">
              <p className="flex gap-5"><span className="w-12 text-muted-foreground">To</span><span>Maya Chen</span></p>
              <p className="flex gap-5"><span className="w-12 text-muted-foreground">Subject</span><span>Tuesday review</span></p>
            </div>
            <div className="pt-6 text-[1.025rem] leading-8 sm:text-lg">
              <p>Hi Maya,</p>
              <p className="mt-4">I finished the launch notes. Would Tuesday afternoon <span className="tab-demo-suggestion text-muted-foreground">work for a quick review?</span></p>
            </div>
          </div>
        </DemoScene>
        <DemoScene name="slack">
          <div>
            <div className="flex items-center gap-3 border-b border-border pb-4">
              <span className="grid size-9 place-items-center rounded-[var(--radius-media)] bg-accent text-sm font-bold text-accent-foreground">P</span>
              <div><p className="text-sm font-semibold"># product</p><p className="text-xs text-muted-foreground">8 teammates</p></div>
            </div>
            <div className="pt-6 text-[1.025rem] leading-8 sm:text-lg">
              <p className="font-semibold">Anthony <span className="ml-1 text-xs font-normal text-muted-foreground">10:42 AM</span></p>
              <p className="mt-1">Quick update: the new onboarding flow is ready <span className="tab-demo-suggestion text-muted-foreground">for a final pass before we ship.</span></p>
            </div>
          </div>
        </DemoScene>
        <DemoScene name="notes">
          <div>
            <div className="border-b border-border pb-4">
              <p className="text-xl font-bold tracking-[-0.02em]">Launch checklist</p>
              <p className="mt-1 text-xs text-muted-foreground">Edited just now</p>
            </div>
            <div className="pt-6 text-[1.025rem] leading-8 sm:text-lg">
              <p>Before launch, remember to <span className="tab-demo-suggestion text-muted-foreground">update the release checklist and notify the support team.</span></p>
            </div>
          </div>
        </DemoScene>
      </div>
      <p className="sr-only" aria-live="polite" data-demo-announcement>Suggestion ready. Press Option plus Tab to accept.</p>
    </div>
  );
}

function AppMarquee() {
  const apps = [...appLogos, ...appLogos];
  return (
    <div className="marketing-marquee overflow-hidden border-y border-border py-4" aria-label="Autocomplete that works anywhere you write on your Mac">
      <div className="marketing-marquee-track flex items-center" aria-hidden="true">
        {apps.map((app, index) => (
          <span className="flex items-center gap-3 whitespace-nowrap px-5 text-sm font-semibold text-muted-foreground sm:px-7" key={`${app.name}-${index}`}>
            <span className="grid size-8 place-items-center rounded-[var(--radius-media)] border border-border bg-white"><img className="size-4" src={app.src} alt="" /></span>
            {app.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export function HomePage() {
  return (
    <>
      <section className="grid gap-12 py-8 lg:grid-cols-[minmax(0,0.88fr)_minmax(31rem,1.12fr)] lg:items-center lg:gap-16 lg:py-20">
        <div className="marketing-intro grid content-center gap-6">
          <PageKicker>Native Autocomplete for your Mac</PageKicker>
          <h1 className="max-w-[10ch] text-balance font-[var(--font-display)] text-[clamp(3.25rem,7vw,6.4rem)] font-bold leading-[0.88] tracking-[-0.065em]">Keep the thought. Skip the typing.</h1>
          <p className="max-w-[34rem] text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl">Tab suggests the next few words in the Mac apps where you already write. Preview the phrase, press Option+Tab, and keep moving.</p>
          <div className="flex flex-col gap-3 min-[420px]:flex-row">
            <a className={buttonVariants({ size: "lg" })} href="/download">
              <DownloadSimple data-icon="inline-start" aria-hidden="true" />
              Download for macOS
            </a>
            <a className={buttonVariants({ variant: "secondary", size: "lg" })} href="#demo">
              See it in action
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </a>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><CheckCircle aria-hidden="true" /> macOS 14+</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle aria-hidden="true" /> 100 suggestions free</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle aria-hidden="true" /> You approve every insertion</span>
          </div>
        </div>
        <div id="demo" className="scroll-mt-24">
          <AutocompleteDemo />
        </div>
      </section>

      <AppMarquee />

      <section id="features" className="scroll-mt-24 py-20 sm:py-28">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] lg:gap-20">
          <div>
            <PageKicker>Less friction, same voice</PageKicker>
            <h2 className="mt-4 max-w-[12ch] text-balance font-[var(--font-display)] text-[clamp(2.25rem,5vw,4.25rem)] font-bold leading-[0.98] tracking-[-0.05em]">The thought is already there. Typing it should not be the slow part.</h2>
          </div>
          <div className="grid border-t border-border">
            {benefits.map((benefit) => {
              const Icon = benefit.icon;
              return (
                <article className="grid gap-4 border-b border-border py-6 sm:grid-cols-[2.5rem_1fr] sm:gap-5" key={benefit.title}>
                  <Icon className="mt-0.5" aria-hidden="true" />
                  <div>
                    <h3 className="text-xl font-bold tracking-[-0.02em]">{benefit.title}</h3>
                    <p className="mt-2 max-w-[36rem] text-pretty leading-relaxed text-muted-foreground">{benefit.description}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <div className="mt-20 grid overflow-hidden rounded-[var(--radius-surface)] border border-border bg-card lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
          <div className="p-6 sm:p-10 lg:p-14">
            <PageKicker>Personal Memory, made visible</PageKicker>
            <h3 className="mt-4 max-w-[13ch] text-balance font-[var(--font-display)] text-3xl font-bold leading-tight tracking-[-0.04em] sm:text-4xl">Personal, without becoming mysterious.</h3>
            <p className="mt-5 max-w-[32rem] text-pretty text-lg leading-relaxed text-muted-foreground">Tab can remember useful details from your own writing. Every saved fact has a place in your dashboard, with controls to edit or delete it.</p>
            <div className="mt-8 grid gap-3 text-sm font-medium sm:grid-cols-2">
              <p className="flex items-center gap-2"><ShieldCheck aria-hidden="true" /> Review what is saved</p>
              <p className="flex items-center gap-2"><LockKey aria-hidden="true" /> Delete memories anytime</p>
            </div>
          </div>
          <div className="border-t border-border bg-muted/30 p-5 lg:border-l lg:border-t-0 lg:p-8">
            <div className="rounded-[var(--radius-card)] border border-border bg-background shadow-[0_18px_50px_rgba(0,0,0,0.08)]">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div><p className="text-sm font-bold">Personal Memory</p><p className="text-xs text-muted-foreground">Saved memories · 3 details</p></div>
                <span className="grid size-8 place-items-center rounded-[var(--radius-control)] border border-border bg-secondary text-muted-foreground" aria-hidden="true"><Plus /></span>
              </div>
              <div className="divide-y divide-border p-2">
                {["Prefers meetings after 1 PM", "Works on the product team", "Uses concise project updates"].map((memory, index) => (
                  <div className="flex items-start justify-between gap-4 rounded-[var(--radius-control)] px-2 py-3" key={memory}>
                    <div className="flex gap-2.5"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--success)]" /><p className="text-sm leading-relaxed">{memory}</p></div>
                    <span className="font-[var(--font-code)] text-[0.65rem] text-muted-foreground">0{index + 1}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-24 border-y border-border py-20 sm:py-24">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.68fr)_minmax(0,1.32fr)] lg:gap-20">
          <div>
            <PageKicker>One shortcut, three steps</PageKicker>
            <h2 className="mt-4 text-balance font-[var(--font-display)] text-4xl font-bold leading-tight tracking-[-0.045em]">From blank space to finished phrase.</h2>
            <p className="mt-5 max-w-md text-pretty leading-relaxed text-muted-foreground">Tab is designed to stay peripheral. It helps at the moment of typing, then disappears from the workflow.</p>
          </div>
          <ol className="grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-border bg-border sm:grid-cols-3">
            {steps.map((step) => (
              <li className="bg-card p-6 sm:min-h-72 sm:p-7" key={step.number}>
                <span className="font-[var(--font-code)] text-xs font-semibold text-muted-foreground">{step.number}</span>
                <h3 className="mt-16 text-xl font-bold tracking-[-0.02em] sm:mt-20">{step.title}</h3>
                <p className="mt-3 text-pretty text-sm leading-relaxed text-muted-foreground">{step.description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="py-20 sm:py-28">
        <div className="grid gap-8 sm:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] sm:items-end">
          <div>
            <PageKicker>Small examples, every day</PageKicker>
            <h2 className="mt-4 text-balance font-[var(--font-display)] text-4xl font-bold leading-tight tracking-[-0.045em]">Useful words, right where they belong.</h2>
          </div>
          <p className="max-w-[36rem] text-pretty text-lg leading-relaxed text-muted-foreground">Tab is not another destination. It shortens the routine parts of writing while leaving the idea, judgment, and final wording with you.</p>
        </div>
        <div className="mt-12 grid border-y border-border lg:grid-cols-3">
          {useCases.map((example) => (
            <article className="group border-b border-border py-7 last:border-b-0 lg:border-b-0 lg:border-l lg:px-7 lg:first:border-l-0 lg:first:pl-0 lg:last:pr-0" key={example.context}>
              <div className="flex items-center justify-between gap-3 text-xs font-semibold text-muted-foreground"><span>{example.context}</span><span>{example.app}</span></div>
              <p className="mt-12 text-lg leading-8">{example.lead} <span className="text-muted-foreground transition-colors duration-200 ease-[var(--tab-ease-out)] group-hover:text-foreground">{example.suggestion}</span></p>
              <p className="mt-6 inline-flex items-center gap-2 font-[var(--font-code)] text-[0.6875rem] font-semibold text-muted-foreground"><Command aria-hidden="true" /> Option + Tab to accept</p>
            </article>
          ))}
        </div>
      </section>

      <section id="open-source" className="scroll-mt-24 border-t border-border py-20 sm:py-24">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(27rem,1.15fr)] lg:items-center lg:gap-20">
          <div>
            <PageKicker>Open source by default</PageKicker>
            <h2 className="mt-4 max-w-[12ch] text-balance font-[var(--font-display)] text-[clamp(2.5rem,5vw,4.5rem)] font-bold leading-[0.98] tracking-[-0.05em]">Trust the product. Inspect the work.</h2>
            <p className="mt-6 max-w-[36rem] text-pretty text-lg leading-relaxed text-muted-foreground">Tab is developed in public. Read the implementation, follow architectural decisions, report a bug, or see what is being built next.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a className={buttonVariants({ size: "lg" })} href="https://github.com/crafter-station/tab" target="_blank" rel="noreferrer">
                <span className="grid size-5 place-items-center rounded-sm bg-white" data-icon="inline-start" aria-hidden="true"><img className="size-3.5" src="/logos/github.svg" alt="" /></span>
                Explore the source
                <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
              </a>
              <a className={buttonVariants({ variant: "secondary", size: "lg" })} href="https://github.com/crafter-station/tab/issues" target="_blank" rel="noreferrer">View issues</a>
            </div>
          </div>
          <a className="group block overflow-hidden rounded-[var(--radius-card)] border border-border bg-card no-underline shadow-[0_24px_70px_rgba(0,0,0,0.1)] transition-transform duration-200 ease-[var(--tab-ease-out)] active:scale-[0.99]" href="https://github.com/crafter-station/tab" target="_blank" rel="noreferrer" aria-label="Open the crafter-station/tab GitHub repository">
            <div className="flex items-center justify-between gap-4 border-b border-border bg-muted/30 px-4 py-3 sm:px-5">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-[var(--radius-media)] border border-border bg-white"><img className="size-5" src="/logos/github.svg" alt="" /></span>
                <div><p className="text-sm font-bold">crafter-station / tab</p><p className="text-xs text-muted-foreground">Public repository</p></div>
              </div>
              <ArrowUpRight className="text-muted-foreground" aria-hidden="true" />
            </div>
            <div className="grid gap-1 p-4 font-[var(--font-code)] text-xs sm:p-5">
              {[
                { name: "apps/desktop", note: "native autocomplete runtime" },
                { name: "apps/web", note: "account and marketing surface" },
                { name: "apps/api", note: "suggestions, memory, and billing" },
                { name: "docs/adr", note: "architectural decisions" },
                { name: "CONTEXT.md", note: "shared product language" },
              ].map((entry) => (
                <div className="grid grid-cols-[minmax(7rem,0.65fr)_minmax(0,1fr)] gap-4 rounded-[var(--radius-control)] px-3 py-2.5 transition-colors duration-150 group-hover:bg-muted/60" key={entry.name}>
                  <span className="font-semibold text-foreground">{entry.name}</span>
                  <span className="truncate text-muted-foreground">{entry.note}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs font-semibold text-muted-foreground"><span>Native macOS autocomplete</span><span>View on GitHub</span></div>
          </a>
        </div>
      </section>

      <section className="-mx-5 bg-foreground px-5 py-20 text-background sm:-mx-8 sm:px-8 sm:py-24">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,0.82fr)] lg:items-center lg:gap-20">
          <div>
            <p className="font-[var(--font-code)] text-xs font-semibold uppercase tracking-[0.12em] text-background/60">Clear boundaries by design</p>
            <h2 className="mt-4 max-w-[13ch] text-balance font-[var(--font-display)] text-[clamp(2.5rem,5vw,4.75rem)] font-bold leading-[0.96] tracking-[-0.05em]">Your writing is not a black box.</h2>
            <p className="mt-6 max-w-[36rem] text-pretty text-lg leading-relaxed text-background/70">Tab asks for only the macOS permissions needed to read the current typing context, show a suggestion, and insert it when you accept. It does not need screenshots, your clipboard, or full documents.</p>
            <a className="mt-8 inline-flex items-center gap-2 border-b border-background/35 pb-1 text-sm font-semibold no-underline transition-colors duration-150 hover:border-background" href="/privacy">Read the privacy policy <ArrowRight aria-hidden="true" /></a>
          </div>
          <div className="grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-background/20 bg-background/20">
            {[
              { icon: Keyboard, title: "Recent typing context", note: "Used to form a relevant suggestion" },
              { icon: ShieldCheck, title: "No raw key log", note: "Navigation and shortcuts are filtered out" },
              { icon: Eye, title: "Visible memories", note: "Review and control saved personal facts" },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div className="flex gap-4 bg-foreground p-5 sm:p-6" key={item.title}>
                  <Icon className="mt-0.5 shrink-0" aria-hidden="true" />
                  <div><h3 className="font-bold">{item.title}</h3><p className="mt-1 text-sm leading-relaxed text-background/60">{item.note}</p></div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section id="pricing" className="scroll-mt-24 py-20 sm:py-28">
        <div className="text-center">
          <PageKicker>Start small, move when you need to</PageKicker>
          <h2 className="mx-auto mt-4 max-w-[14ch] text-balance font-[var(--font-display)] text-4xl font-bold leading-tight tracking-[-0.045em] sm:text-5xl">Pay for the writing volume you actually use.</h2>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">The same native autocomplete and Personal Memory controls are included on every plan.</p>
        </div>
        <div className="mx-auto mt-12 grid max-w-4xl gap-4 md:grid-cols-2">
          {(["free", "pro"] as const).map((planId) => {
            const plan = planQuotas[planId];
            const featured = planId === "pro";
            return (
              <article className={`flex flex-col rounded-[var(--radius-card)] border p-6 sm:p-8 ${featured ? "border-foreground bg-foreground text-background" : "border-border bg-card"}`} key={planId}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xl font-bold">{plan.name}</h3>
                  {featured ? <span className="rounded-full border border-background/20 px-2.5 py-1 text-[0.6875rem] font-semibold text-background/70">Daily writing</span> : null}
                </div>
                <p className={`mt-8 font-[var(--font-display)] text-5xl font-bold tracking-[-0.05em] ${featured ? "text-background" : "text-foreground"}`}>{formatMonthlyPrice(plan.monthlyPriceUsd)}</p>
                <p className={`mt-3 text-sm ${featured ? "text-background/65" : "text-muted-foreground"}`}>{formatCount(plan.monthlyAutocompleteSuggestions)} suggestions each month</p>
                <ul className={`mt-8 grid flex-1 gap-3 text-sm ${featured ? "text-background/75" : "text-muted-foreground"}`}>
                  <li className="flex items-center gap-2"><Check aria-hidden="true" /> Works across supported Mac apps</li>
                  <li className="flex items-center gap-2"><Check aria-hidden="true" /> Personal Memory controls</li>
                  <li className="flex items-center gap-2"><Check aria-hidden="true" /> Change plans from your account</li>
                </ul>
                <a className={buttonVariants({ variant: featured ? "secondary" : "default", size: "lg", className: "mt-8 w-full" })} href={planId === "free" ? "/signup" : "/billing/checkout?plan=pro"}>{planId === "free" ? "Start with 100 free suggestions" : "Choose Pro"}</a>
              </article>
            );
          })}
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">Need much more volume? <a className="font-semibold text-foreground underline decoration-border underline-offset-4" href="/pricing">Compare every plan</a>.</p>
      </section>

      <section className="border-t border-border py-20 sm:py-24">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.65fr)_minmax(0,1.35fr)] lg:gap-20">
          <div>
            <PageKicker>Questions, answered</PageKicker>
            <h2 className="mt-4 text-balance font-[var(--font-display)] text-4xl font-bold leading-tight tracking-[-0.045em]">Know before you install.</h2>
          </div>
          <div className="border-t border-border">
            {faqs.map((faq) => (
              <details className="marketing-detail group border-b border-border" key={faq.question}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-5 py-5 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  {faq.question}
                  <Plus className="marketing-detail-icon shrink-0 transition-transform duration-200 ease-[var(--tab-ease-out)]" aria-hidden="true" />
                </summary>
                <div className="tab-disclosure-panel origin-top-left pb-6 pr-10">
                  <p className="max-w-[42rem] text-pretty leading-relaxed text-muted-foreground">{faq.answer}</p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border py-16 sm:py-24">
        <div className="grid gap-8 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <p className="font-[var(--font-code)] text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Your next sentence can move faster</p>
            <h2 className="mt-4 max-w-[13ch] text-balance font-[var(--font-display)] text-[clamp(2.75rem,6vw,5.5rem)] font-bold leading-[0.92] tracking-[-0.06em]">Stay with the idea, not the keys.</h2>
          </div>
          <div className="sm:text-right">
            <a className={buttonVariants({ size: "lg" })} href="/download"><DownloadSimple data-icon="inline-start" aria-hidden="true" /> Download Tab free</a>
            <p className="mt-3 text-sm text-muted-foreground">macOS 14 or newer</p>
          </div>
        </div>
      </section>
      <script src="/marketing-demo.js" defer />
    </>
  );
}
