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
} from "@phosphor-icons/react";
import { planCapabilities } from "@tab/billing";
import { SuggestionCommand, buttonVariants, cn } from "@tab/ui";
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

const productPromises = [
  {
    quote: "Nothing is inserted until you choose.",
    description: "Every suggestion stays separate from your draft until you press Option+Tab or click to accept it.",
  },
  {
    quote: "Keep typing and Tab gets out of the way.",
    description: "A suggestion is optional, never a modal. Continue the sentence and stale text disappears.",
  },
  {
    quote: "Personal should never mean hidden.",
    description: "Personal Memory is visible in your account, where you can review and delete what Tab remembers.",
  },
] as const;

const memoryExamples = [
  {
    memory: "Prefers meetings after 1 PM",
    context: "Scheduling email",
    lead: "Would Thursday",
    suggestion: "after 1 PM work for a quick review?",
  },
  {
    memory: "Works on the product team",
    context: "Team update",
    lead: "The onboarding flow is ready",
    suggestion: "for the product team's final pass.",
  },
  {
    memory: "Uses concise project updates",
    context: "Project note",
    lead: "Quick update:",
    suggestion: "onboarding is ready for review.",
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
    answer: `Yes. Every account starts with a 30-day Pro trial, no card required. Afterward, Free includes ${formatCount(planCapabilities.free.localAcceptedWordsPerDay)} Accepted Words from Local Suggestions each day and ${planCapabilities.free.deepCompletesPerMonth} Deep Completes each month.`,
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
      <SuggestionCommand
        aria-label="Accept this suggestion with Option plus Tab"
        className="tab-demo-overlay"
        data-demo-accept
        suggestion={(
          <>
            <span className="tab-demo-ready-label">Suggestion ready</span>
            <span className="tab-demo-accepted-label hidden">Suggestion added</span>
          </>
        )}
      />
    </div>
  );
}

function AutocompleteDemo() {
  return (
    <div className="tab-demo overflow-hidden rounded-[var(--radius-surface)] border border-border bg-card text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" data-tab-demo data-active="mail" data-accepted="false" aria-label="Interactive Tab autocomplete demonstration" role="region" tabIndex={0}>
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
          <button className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-border bg-background px-3 py-1.5 text-xs font-semibold capitalize transition-[background-color,border-color,color,transform] duration-150 ease-[var(--tab-ease-out)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-demo-target={app} id={`demo-tab-${app}`} key={app} tabIndex={index === 0 ? 0 : -1} type="button" role="tab" aria-controls={`demo-panel-${app}`} aria-selected={index === 0}>
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
              <p className="text-xl font-bold">Launch checklist</p>
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

function AppLogo({ name, src }: (typeof appLogos)[number]) {
  return (
    <span className="flex items-center gap-3 whitespace-nowrap text-sm font-semibold text-muted-foreground">
      <span className="grid size-8 place-items-center rounded-[var(--radius-media)] border border-border bg-white"><img className="size-4" src={src} alt="" /></span>
      {name}
    </span>
  );
}

function MotionToggle({ controls, className }: { controls: string; className?: string }) {
  return (
    <button
      className={cn(
        "tab-motion-toggle inline-flex cursor-pointer items-center rounded-[var(--radius-control)] border border-border bg-background/90 px-2 py-1 text-xs font-semibold text-muted-foreground shadow-[var(--tab-shadow-control)] transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      type="button"
      data-motion-toggle
      aria-controls={controls}
      aria-pressed="false"
    >
      <span data-motion-toggle-label>Pause animation</span>
    </button>
  );
}

function AppMarquee() {
  return (
    <div id="app-marquee-animation" className="tab-app-marquee relative border-y border-border py-4" aria-label="Autocomplete that works anywhere you write on your Mac" role="region" data-motion-region data-motion-paused="false">
      <div className="tab-app-marquee-viewport overflow-hidden">
        <div className="tab-app-marquee-track flex w-max items-center">
          <div className="tab-app-marquee-group flex items-center gap-7 pr-7">
            {appLogos.map((app) => <AppLogo key={app.name} {...app} />)}
          </div>
          <div className="tab-app-marquee-copy flex items-center gap-7 pr-7" aria-hidden="true">
            {appLogos.map((app) => <AppLogo key={app.name} {...app} />)}
          </div>
        </div>
      </div>
      <MotionToggle controls="app-marquee-animation" className="absolute right-3 top-1/2 z-10 -translate-y-1/2" />
    </div>
  );
}

function WorkflowMap() {
  const incomingLeft = "M380 76V112C380 137 318 149 250 149H132V164";
  const incomingRight = "M380 112C380 137 442 149 510 149H628V164";
  const outgoingLeft = "M132 206V228C132 252 228 266 315 266H342";
  const outgoingRight = "M628 206V228C628 252 532 266 445 266H418";
  const paths = [incomingLeft, incomingRight, outgoingLeft, outgoingRight];

  return (
    <div className="tab-workflow" data-tab-workflow data-accepted="false">
      <div className="tab-workflow-map relative isolate min-h-[19rem] overflow-hidden bg-[var(--tab-surface-sunken)] sm:min-h-[23rem]">
        <svg className="absolute inset-0 size-full text-border" viewBox="0 0 760 340" preserveAspectRatio="none" aria-hidden="true">
          {paths.map((path) => <path className="tab-workflow-line" d={path} fill="none" stroke="currentColor" key={path} />)}
          {paths.map((path, index) => (
            <circle className="tab-workflow-signal text-foreground" r="4" fill="currentColor" key={`signal-${path}`}>
              <animateMotion begin={`${index * 0.65}s`} dur="3.2s" repeatCount="indefinite" path={path} />
            </circle>
          ))}
        </svg>

        <div className="tab-workflow-node tab-workflow-draft absolute left-1/2 top-[7%] w-[min(76%,23rem)] -translate-x-1/2 rounded-[var(--radius-card)] border border-border bg-card p-3 shadow-[var(--tab-shadow-card)] sm:p-4">
          <p className="font-[var(--font-code)] text-[0.625rem] font-semibold uppercase text-muted-foreground">Your thought</p>
          <p className="mt-1 truncate text-sm font-semibold sm:text-base">Would Tuesday afternoon <span className="tab-workflow-completion text-muted-foreground">work for a quick review?</span></p>
        </div>

        <div className="tab-workflow-node absolute left-[7%] top-[40%] flex w-[28%] max-w-40 items-center gap-2 rounded-[var(--radius-card)] border border-border bg-card p-2.5 shadow-[var(--tab-shadow-card)] sm:gap-3 sm:p-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-media)] border border-border bg-white"><img className="size-4" src="/logos/apple.svg" alt="" /></span>
          <span className="min-w-0"><span className="block truncate text-sm font-bold">Mail</span><span className="hidden truncate text-xs text-muted-foreground min-[460px]:block">Active app</span></span>
        </div>

        <div className="tab-workflow-node absolute right-[7%] top-[40%] flex w-[28%] max-w-40 items-center gap-2 rounded-[var(--radius-card)] border border-border bg-card p-2.5 shadow-[var(--tab-shadow-card)] sm:gap-3 sm:p-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-media)] border border-border bg-white"><img className="size-4" src="/logos/slack.svg" alt="" /></span>
          <span className="min-w-0"><span className="block truncate text-sm font-bold">Slack</span><span className="hidden truncate text-xs text-muted-foreground min-[460px]:block">Active app</span></span>
        </div>

        <div className="absolute bottom-[10%] left-1/2 w-[min(86%,33rem)] -translate-x-1/2">
          <SuggestionCommand
            aria-label="Accept the workflow suggestion with Option plus Tab"
            className="tab-workflow-command"
            data-workflow-accept
            suggestion={(
              <>
                <span className="tab-workflow-ready-label">work for a quick review?</span>
                <span className="tab-workflow-accepted-label hidden">Added to your sentence</span>
              </>
            )}
          />
        </div>
      </div>

      <ol className="grid border-t border-border md:grid-cols-3">
        {steps.map((step, index) => (
          <li className="grid min-h-48 content-between gap-8 border-b border-border p-5 last:border-b-0 md:border-b-0 md:border-l md:first:border-l-0 md:p-6" key={step.number}>
            <span className="font-[var(--font-code)] text-xs font-semibold text-muted-foreground">{step.number}</span>
            <div>
              <h3 className="text-lg font-bold">{step.title}</h3>
              <p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">{step.description}</p>
              {index === 2 ? <p className="mt-4 font-[var(--font-code)] text-[0.6875rem] font-semibold text-foreground">Try the overlay above</p> : null}
            </div>
          </li>
        ))}
      </ol>
      <p className="sr-only" aria-live="polite" data-workflow-announcement>Suggestion ready. Press Option plus Tab or click to accept.</p>
    </div>
  );
}

function MemoryShowcase() {
  const featureDetails = [
    { icon: Brain, title: "Relevant details only", description: "Useful facts can shape a suggestion when they match what you are writing." },
    { icon: Eye, title: "Visible in your account", description: "Every saved memory has a readable place in your dashboard." },
    { icon: LockKey, title: "Delete it anytime", description: "You decide what stays available for future suggestions." },
  ] as const;

  return (
    <section id="personal-memory" className="scroll-mt-24 border-t border-border py-20 sm:py-24">
      <div className="max-w-3xl">
        <PageKicker>Personal Memory</PageKicker>
        <h2 className="mt-4 max-w-[13ch] text-balance font-[var(--font-display)] text-[clamp(2.5rem,5vw,4.75rem)] font-bold leading-[0.96] tracking-[-0.03em]">Suggestions that remember what matters.</h2>
        <p className="mt-6 max-w-[38rem] text-pretty text-lg leading-relaxed text-muted-foreground">Tab can bring useful details from your own writing into the next phrase, without turning Personal Memory into a hidden profile.</p>
        <a className={buttonVariants({ variant: "secondary", size: "lg", className: "mt-8" })} href="/signup">Start free <ArrowRight data-icon="inline-end" aria-hidden="true" /></a>
      </div>

      <div id="memory-showcase-animation" className="mt-12 overflow-hidden rounded-[var(--radius-surface)] border border-border bg-card shadow-[var(--tab-shadow-card)]" data-animated-showcase data-restarting="false" data-motion-region data-motion-paused="false">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-muted/30 px-4 py-3 sm:px-5">
          <div><p className="text-sm font-bold">Live relevance demo</p><p className="text-xs text-muted-foreground">A matching memory shapes the next phrase</p></div>
          <div className="flex shrink-0 items-center gap-1">
            <MotionToggle controls="memory-showcase-animation" />
            <button className="tab-showcase-replay inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-control)] px-2 py-1 text-xs font-semibold text-muted-foreground transition-[color,transform] duration-150 ease-[var(--tab-ease-out)] hover:text-foreground active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" type="button" data-showcase-replay>
              <ArrowClockwise aria-hidden="true" /> Replay
            </button>
          </div>
        </div>

        <div className="tab-showcase-canvas tab-memory-stage grid items-center gap-5 p-5 md:grid-cols-[minmax(0,0.9fr)_4rem_minmax(0,1.1fr)] md:p-10 lg:gap-8 lg:p-14">
          <div className="rounded-[var(--radius-card)] border border-border bg-background shadow-[var(--tab-shadow-card)]">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div><p className="text-sm font-bold">Personal Memory</p><p className="text-xs text-muted-foreground">Saved memories</p></div>
              <span className="rounded-full border border-border bg-secondary px-2 py-1 font-[var(--font-code)] text-[0.625rem] font-semibold text-muted-foreground">3 active</span>
            </div>
            <div className="tab-memory-list grid gap-1 p-2">
              {memoryExamples.map((example, index) => (
                <div className="tab-memory-row flex items-start justify-between gap-3 rounded-[var(--radius-control)] border border-transparent px-3 py-3" key={example.memory}>
                  <div className="flex gap-2.5"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--success)]" /><p className="text-sm leading-relaxed">{example.memory}</p></div>
                  <span className="font-[var(--font-code)] text-[0.625rem] text-muted-foreground">0{index + 1}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="tab-memory-transfer relative mx-auto h-12 w-px bg-border md:h-px md:w-full" aria-hidden="true"><span className="tab-memory-transfer-dot absolute size-2 rounded-full bg-foreground" /></div>

          <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-background shadow-[var(--tab-shadow-card)]">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div><p className="text-sm font-bold">Current draft</p><p className="text-xs text-muted-foreground">Mail</p></div>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><span className="size-1.5 rounded-full bg-[var(--success)]" /> Memory on</span>
            </div>
            <div className="tab-memory-output-stack relative min-h-52 p-4 sm:min-h-48 sm:p-5" aria-hidden="true">
              {memoryExamples.map((example) => (
                <div className="tab-memory-output absolute inset-4 grid content-between gap-6 sm:inset-5" key={example.memory}>
                  <div>
                    <p className="font-[var(--font-code)] text-[0.625rem] font-semibold uppercase text-muted-foreground">{example.context}</p>
                    <p className="mt-4 text-lg leading-8">{example.lead} <span className="text-muted-foreground">{example.suggestion}</span></p>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border bg-[var(--tab-success-tint)] px-3 py-2 text-xs">
                    <span className="truncate font-semibold text-foreground">Used: {example.memory}</span>
                    <span className="shrink-0 font-[var(--font-code)] text-muted-foreground">Relevant</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid border-t border-border md:grid-cols-3">
          {featureDetails.map((detail, index) => {
            const Icon = detail.icon;
            return (
              <article className="grid min-h-48 content-between gap-8 border-b border-border p-5 last:border-b-0 md:border-b-0 md:border-l md:first:border-l-0 md:p-6" key={detail.title}>
                <div className="flex items-center justify-between"><Icon aria-hidden="true" /><span className="font-[var(--font-code)] text-xs text-muted-foreground">0{index + 1}</span></div>
                <div><h3 className="text-lg font-bold">{detail.title}</h3><p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">{detail.description}</p></div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function PrivacyPipeline() {
  const featureDetails = [
    { icon: Keyboard, title: "Automatic stays local", description: "Routine Automatic Suggestions run on your Mac without sending Typing Context to Tab." },
    { icon: ShieldCheck, title: "Explicit cloud boundary", description: "Deep Complete sends bounded, redacted context only after you double-tap Option." },
    { icon: Eye, title: "No raw typing log", description: "Suggestion telemetry records product events and metadata, not your draft text." },
  ] as const;

  return (
    <section id="privacy-by-design" className="scroll-mt-24 border-y border-border py-20 sm:py-24">
      <div className="max-w-3xl">
        <PageKicker>Privacy by construction</PageKicker>
        <h2 className="mt-4 max-w-[14ch] text-balance font-[var(--font-display)] text-[clamp(2.5rem,5vw,4.75rem)] font-bold leading-[0.96] tracking-[-0.03em]">Useful context in. Raw typing logs out.</h2>
        <p className="mt-6 max-w-[40rem] text-pretty text-lg leading-relaxed text-muted-foreground">Automatic Suggestions never need a cloud request. When you explicitly invoke Deep Complete, obvious secrets are removed and only bounded, redacted context moves forward.</p>
        <a className={buttonVariants({ variant: "secondary", size: "lg", className: "mt-8" })} href="/privacy">Read the privacy design <ArrowRight data-icon="inline-end" aria-hidden="true" /></a>
      </div>

      <div id="privacy-showcase-animation" className="mt-12 overflow-hidden rounded-[var(--radius-surface)] border border-border bg-card shadow-[var(--tab-shadow-card)]" data-animated-showcase data-restarting="false" data-motion-region data-motion-paused="false">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-muted/30 px-4 py-3 sm:px-5">
          <div><p className="text-sm font-bold">Deep Complete boundary</p><p className="text-xs text-muted-foreground">What moves only after your explicit action</p></div>
          <div className="flex shrink-0 items-center gap-1">
            <MotionToggle controls="privacy-showcase-animation" />
            <button className="tab-showcase-replay inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-control)] px-2 py-1 text-xs font-semibold text-muted-foreground transition-[color,transform] duration-150 ease-[var(--tab-ease-out)] hover:text-foreground active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" type="button" data-showcase-replay>
              <ArrowClockwise aria-hidden="true" /> Replay
            </button>
          </div>
        </div>

        <div className="tab-showcase-canvas tab-privacy-stage grid items-center gap-4 p-5 md:grid-cols-[minmax(0,1fr)_3rem_minmax(0,0.9fr)_3rem_minmax(0,1fr)] md:p-8 lg:gap-6 lg:p-12">
          <div className="rounded-[var(--radius-card)] border border-border bg-background p-4 shadow-[var(--tab-shadow-card)] sm:p-5">
            <div className="flex items-center justify-between gap-3"><p className="text-sm font-bold">Recent typing context</p><span className="font-[var(--font-code)] text-[0.625rem] text-muted-foreground">On this Mac</span></div>
            <div className="mt-5 rounded-[var(--radius-control)] border border-border bg-muted/35 p-3 font-[var(--font-code)] text-xs leading-6">
              <p>Send the launch notes to Maya</p>
              <p className="text-muted-foreground">token: <span className="rounded bg-[var(--tab-destructive-tint)] px-1.5 py-0.5 text-destructive">[REDACTED]</span></p>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">Navigation, shortcuts, and passive app content are not Typing Context.</p>
          </div>

          <div className="tab-privacy-transfer relative mx-auto h-10 w-px bg-border md:h-px md:w-full" aria-hidden="true"><span className="tab-privacy-transfer-dot absolute size-2 rounded-full bg-foreground" /></div>

          <div className="rounded-[var(--radius-card)] border border-border bg-background p-4 shadow-[var(--tab-shadow-card)] sm:p-5">
            <p className="text-sm font-bold">Local guardrails</p>
            <div className="tab-privacy-checks mt-4 grid gap-2">
              {["Secure input suppressed", "Secrets redacted locally", "Context bounded"].map((check) => (
                <div className="tab-privacy-check flex items-center gap-2 rounded-[var(--radius-control)] border border-border px-3 py-2.5 text-xs font-semibold" key={check}><CheckCircle aria-hidden="true" /> {check}</div>
              ))}
            </div>
          </div>

          <div className="tab-privacy-transfer relative mx-auto h-10 w-px bg-border md:h-px md:w-full" aria-hidden="true"><span className="tab-privacy-transfer-dot tab-privacy-transfer-dot-delayed absolute size-2 rounded-full bg-foreground" /></div>

          <div className="tab-privacy-request relative overflow-hidden rounded-[var(--radius-card)] border border-border bg-background p-4 shadow-[var(--tab-shadow-card)] sm:p-5">
            <div className="flex items-center justify-between gap-3"><p className="text-sm font-bold">Deep Complete request</p><span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--success)]"><span className="size-1.5 rounded-full bg-[var(--success)]" /> Explicit</span></div>
            <dl className="mt-5 grid gap-2 font-[var(--font-code)] text-xs">
              <div className="flex justify-between gap-3 border-b border-border pb-2"><dt className="text-muted-foreground">typing_context</dt><dd>bounded</dd></div>
              <div className="flex justify-between gap-3 border-b border-border pb-2"><dt className="text-muted-foreground">secret_like_text</dt><dd>redacted</dd></div>
              <div className="flex justify-between gap-3 border-b border-border pb-2"><dt className="text-muted-foreground">raw_typing_log</dt><dd>none</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">screenshot</dt><dd>none</dd></div>
            </dl>
          </div>
        </div>

        <div className="grid border-t border-border md:grid-cols-3">
          {featureDetails.map((detail, index) => {
            const Icon = detail.icon;
            return (
              <article className="grid min-h-48 content-between gap-8 border-b border-border p-5 last:border-b-0 md:border-b-0 md:border-l md:first:border-l-0 md:p-6" key={detail.title}>
                <div className="flex items-center justify-between"><Icon aria-hidden="true" /><span className="font-[var(--font-code)] text-xs text-muted-foreground">0{index + 1}</span></div>
                <div><h3 className="text-lg font-bold">{detail.title}</h3><p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">{detail.description}</p></div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function HomePage() {
  return (
    <>
      <section className="grid gap-12 py-8 lg:grid-cols-[minmax(0,0.88fr)_minmax(31rem,1.12fr)] lg:items-center lg:gap-16 lg:py-20">
        <div className="marketing-intro grid content-center gap-6">
          <a className="marketing-announcement flex w-fit items-center gap-2 rounded-full border border-border bg-card py-1.5 pl-2 pr-3 text-xs font-semibold text-foreground no-underline shadow-[var(--tab-shadow-control)] transition-[background-color,transform] duration-150 ease-[var(--tab-ease-out)] hover:bg-secondary active:scale-[0.97]" href="#pricing">
            <span className="rounded-full bg-foreground px-2 py-0.5 text-[0.625rem] uppercase text-background">Free</span>
            30 days of Pro, no card
            <ArrowRight aria-hidden="true" />
          </a>
          <PageKicker>Native Autocomplete for your Mac</PageKicker>
          <h1 className="max-w-[10ch] text-balance font-[var(--font-display)] text-[clamp(3.25rem,7vw,6.4rem)] font-bold leading-[0.88] tracking-[-0.035em]">Keep the thought. Skip the typing.</h1>
          <p className="max-w-[36rem] text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl">Copilot handles the code. Tab handles everything around it, with private Local Suggestions as you type and Deep Complete when you explicitly ask.</p>
          <div className="flex flex-col gap-3 min-[420px]:flex-row">
            <a className={buttonVariants({ size: "lg" })} href="/download/tab.dmg">
              <DownloadSimple data-icon="inline-start" aria-hidden="true" />
              Download Tab free
            </a>
            <a className={buttonVariants({ variant: "secondary", size: "lg" })} href="#demo">
              Try the live demo
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </a>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><CheckCircle aria-hidden="true" /> macOS 14+</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle aria-hidden="true" /> {formatCount(planCapabilities.free.localAcceptedWordsPerDay)} Accepted Words free each day</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle aria-hidden="true" /> You approve every insertion</span>
          </div>
        </div>
        <div id="demo" className="scroll-mt-24">
          <AutocompleteDemo />
        </div>
      </section>

      <AppMarquee />

      <section className="border-b border-border py-16 sm:py-20" aria-labelledby="why-tab-quote">
        <figure className="marketing-quote relative overflow-hidden rounded-[var(--radius-surface)] border border-border bg-card px-6 py-10 sm:px-10 sm:py-14 lg:grid lg:grid-cols-[minmax(12rem,0.45fr)_minmax(0,1.55fr)] lg:items-start lg:gap-12">
          <figcaption className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-[var(--radius-media)] border border-border bg-foreground font-[var(--font-code)] text-lg font-bold text-background" aria-hidden="true">T</span>
            <span><span className="block font-[var(--font-code)] text-[0.6875rem] font-semibold uppercase text-muted-foreground">Why Tab exists</span><span className="mt-0.5 block text-sm font-semibold">A product principle</span></span>
          </figcaption>
          <blockquote id="why-tab-quote" className="mt-8 text-balance font-[var(--font-display)] text-[clamp(1.75rem,4vw,3.5rem)] font-semibold leading-[1.08] tracking-[-0.025em] lg:mt-0">
            &ldquo;Writing with AI should not mean leaving the sentence to brief a chatbot.&rdquo;
          </blockquote>
        </figure>
      </section>

      <section id="features" className="scroll-mt-24 py-20 sm:py-28">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] lg:gap-20">
          <div>
            <PageKicker>Less friction, same voice</PageKicker>
            <h2 className="mt-4 max-w-[12ch] text-balance font-[var(--font-display)] text-[clamp(2.25rem,5vw,4.25rem)] font-bold leading-[0.98] tracking-[-0.03em]">The thought is already there. Typing it should not be the slow part.</h2>
          </div>
          <div className="grid border-t border-border">
            {benefits.map((benefit) => {
              const Icon = benefit.icon;
              return (
                <article className="grid gap-4 border-b border-border py-6 sm:grid-cols-[2.5rem_1fr] sm:gap-5" key={benefit.title}>
                  <Icon className="mt-0.5" aria-hidden="true" />
                  <div>
                    <h3 className="text-xl font-bold">{benefit.title}</h3>
                    <p className="mt-2 max-w-[36rem] text-pretty leading-relaxed text-muted-foreground">{benefit.description}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

      </section>

      <MemoryShowcase />

      <section id="how-it-works" className="scroll-mt-24 border-y border-border py-20 sm:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <PageKicker>One shortcut, every app</PageKicker>
          <h2 className="mt-4 text-balance font-[var(--font-display)] text-4xl font-bold leading-tight tracking-[-0.02em] sm:text-5xl">The sentence stays in front of you.</h2>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">Tab follows the active application, previews a useful continuation, and waits. Your app keeps focus through the entire loop.</p>
        </div>
        <div className="mt-12 overflow-hidden rounded-[var(--radius-surface)] border border-border bg-card shadow-[var(--tab-shadow-card)]">
          <WorkflowMap />
        </div>
      </section>

      <section className="py-20 sm:py-28">
        <div className="grid gap-8 sm:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] sm:items-end">
          <div>
            <PageKicker>Small examples, every day</PageKicker>
            <h2 className="mt-4 text-balance font-[var(--font-display)] text-4xl font-bold leading-tight tracking-[-0.015em]">Useful words, right where they belong.</h2>
          </div>
          <p className="max-w-[36rem] text-pretty text-lg leading-relaxed text-muted-foreground">Tab is not another destination. It shortens the routine parts of writing while leaving the idea, judgment, and final wording with you.</p>
        </div>
        <div className="mt-12 grid border-y border-border lg:grid-cols-3">
          {useCases.map((example) => (
            <article className="group border-b border-border py-7 last:border-b-0 lg:border-b-0 lg:border-l lg:px-7 lg:first:border-l-0 lg:first:pl-0 lg:last:pr-0" key={example.context}>
              <div className="flex items-center justify-between gap-3 text-xs font-semibold text-muted-foreground"><span>{example.context}</span><span>{example.app}</span></div>
              <p className="mt-12 text-lg leading-8">{example.lead} <span className="text-muted-foreground transition-colors duration-150 ease-[var(--tab-ease-out)] group-hover:text-foreground">{example.suggestion}</span></p>
              <p className="mt-6 inline-flex items-center gap-2 font-[var(--font-code)] text-[0.6875rem] font-semibold text-muted-foreground"><Command aria-hidden="true" /> Option + Tab to accept</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-border py-20 sm:py-24" aria-labelledby="promises-heading">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.62fr)_minmax(0,1.38fr)] lg:gap-16">
          <div>
            <PageKicker>Promises you can test</PageKicker>
            <h2 id="promises-heading" className="mt-4 max-w-[12ch] text-balance font-[var(--font-display)] text-4xl font-bold leading-tight tracking-[-0.015em]">Control is part of the product.</h2>
            <p className="mt-5 max-w-md text-pretty leading-relaxed text-muted-foreground">Tab is early, so the proof is the product: a live demo, public source, visible permissions, and a free plan you can test on your own writing.</p>
          </div>
          <div className="grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-border bg-border sm:grid-cols-3">
            {productPromises.map((promise, index) => (
              <figure className="grid min-h-64 content-between gap-8 bg-card p-6" key={promise.quote}>
                <span className="font-[var(--font-code)] text-xs font-semibold text-muted-foreground">0{index + 1}</span>
                <div>
                  <blockquote className="text-balance font-[var(--font-display)] text-xl font-semibold leading-snug">&ldquo;{promise.quote}&rdquo;</blockquote>
                  <figcaption className="mt-4 text-pretty text-sm leading-relaxed text-muted-foreground">{promise.description}</figcaption>
                </div>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section id="open-source" className="scroll-mt-24 py-20 sm:py-24">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(27rem,1.15fr)] lg:items-center lg:gap-20">
          <div>
            <PageKicker>Open source by default</PageKicker>
            <h2 className="mt-4 max-w-[12ch] text-balance font-[var(--font-display)] text-[clamp(2.5rem,5vw,4.5rem)] font-bold leading-[0.98] tracking-[-0.03em]">Trust the product. Inspect the work.</h2>
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
          <a className="group block overflow-hidden rounded-[var(--radius-card)] border border-border bg-card no-underline shadow-[var(--tab-shadow-card)] transition-transform duration-150 ease-[var(--tab-ease-out)] active:scale-[0.99]" href="https://github.com/crafter-station/tab" target="_blank" rel="noreferrer" aria-label="Open the crafter-station/tab GitHub repository">
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

      <PrivacyPipeline />

      <section id="pricing" className="scroll-mt-24 py-20 sm:py-28">
        <div className="text-center">
          <PageKicker>Start small, move when you need to</PageKicker>
          <h2 className="mx-auto mt-4 max-w-[14ch] text-balance font-[var(--font-display)] text-4xl font-bold leading-tight tracking-[-0.02em] sm:text-5xl">Private for the routine. Pro for the hard parts.</h2>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">Local Suggestions and Deep Complete solve different writing moments. Your memories always remain visible, editable, exportable, and deletable.</p>
        </div>
        <div className="mx-auto mt-12 grid max-w-4xl gap-4 md:grid-cols-2">
          {(["free", "pro"] as const).map((planId) => {
            const plan = planCapabilities[planId];
            const featured = planId === "pro";
            return (
              <article className={`flex flex-col rounded-[var(--radius-card)] border p-6 sm:p-8 ${featured ? "border-foreground bg-foreground text-background" : "border-border bg-card"}`} key={planId}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xl font-bold">{plan.name}</h3>
                  {featured ? <span className="rounded-full border border-background/20 px-2.5 py-1 text-[0.6875rem] font-semibold text-background/70">Daily writing</span> : null}
                </div>
                <p className={`mt-8 font-[var(--font-display)] text-5xl font-bold tracking-[-0.02em] ${featured ? "text-background" : "text-foreground"}`}>{formatMonthlyPrice(plan.monthlyPriceUsd)}</p>
                <p className={`mt-3 text-sm ${featured ? "text-background/65" : "text-muted-foreground"}`}>{plan.localAcceptedWordsPerDay === null ? "Unlimited Local Accepted Words" : `${formatCount(plan.localAcceptedWordsPerDay)} Local Accepted Words / day`}</p>
                <ul className={`mt-8 grid flex-1 gap-3 text-sm ${featured ? "text-background/75" : "text-muted-foreground"}`}>
                  <li className="flex items-center gap-2"><Check aria-hidden="true" /> {plan.deepCompletesPerMonth} Deep Completes / month</li>
                  <li className="flex items-center gap-2"><Check aria-hidden="true" /> {plan.personalDeviceLimit} personal {plan.personalDeviceLimit === 1 ? "Mac" : "Macs"}</li>
                  <li className="flex items-center gap-2"><Check aria-hidden="true" /> {plan.continuousMemoryExtraction ? "Continuous Memory Extraction" : "Manage existing memories"}</li>
                </ul>
                <a className={buttonVariants({ variant: featured ? "secondary" : "default", size: "lg", className: "mt-8 w-full" })} href={planId === "free" ? "/signup" : "/billing/checkout?plan=pro&interval=monthly"}>{planId === "free" ? "Start 30-day Pro trial" : "Choose Pro monthly"}</a>
              </article>
            );
          })}
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">Pro is also available for $96/year. <a className="font-semibold text-foreground underline decoration-border underline-offset-4" href="/pricing">Compare plans</a>.</p>
      </section>

      <section className="border-t border-border py-20 sm:py-24">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.65fr)_minmax(0,1.35fr)] lg:gap-20">
          <div>
            <PageKicker>Questions, answered</PageKicker>
            <h2 className="mt-4 text-balance font-[var(--font-display)] text-4xl font-bold leading-tight tracking-[-0.015em]">Know before you install.</h2>
          </div>
          <div className="border-t border-border">
            {faqs.map((faq) => (
              <details className="marketing-detail group border-b border-border" key={faq.question}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-5 py-5 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  {faq.question}
                  <Plus className="marketing-detail-icon shrink-0 transition-transform duration-150 ease-[var(--tab-ease-out)]" aria-hidden="true" />
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
            <p className="font-[var(--font-code)] text-xs font-semibold uppercase text-muted-foreground">Your next sentence can move faster</p>
            <h2 className="mt-4 max-w-[13ch] text-balance font-[var(--font-display)] text-[clamp(2.75rem,6vw,5.5rem)] font-bold leading-[0.92] tracking-[-0.035em]">Stay with the idea, not the keys.</h2>
          </div>
          <div className="sm:text-right">
            <a className={buttonVariants({ size: "lg" })} href="/download/tab.dmg"><DownloadSimple data-icon="inline-start" aria-hidden="true" /> Download Tab free</a>
            <p className="mt-3 text-sm text-muted-foreground">macOS 14 or newer</p>
          </div>
        </div>
      </section>
      <script src="/marketing-demo.js?v=motion-controls" defer />
    </>
  );
}
