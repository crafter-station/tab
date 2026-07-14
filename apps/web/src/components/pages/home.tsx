import {
  ArrowRight,
  ArrowUpRight,
  Brain,
  CheckCircle,
  DownloadSimple,
  Plus,
  ShieldCheck,
} from "@phosphor-icons/react";
import { planCapabilities } from "@tab/billing";
import { Badge, Button, SuggestionCommand, cn } from "@tab/ui";
import type { CSSProperties } from "react";
import { AutocompleteDemo } from "../marketing/autocomplete-demo.tsx";
import { MotionToggle, ReplayButton } from "../marketing/controls.tsx";
import { DeepCompleteDemo } from "../marketing/deep-complete-demo.tsx";
import { MarketingInteractionProvider } from "../marketing/interaction-provider.tsx";
import { WorkflowInteraction } from "../marketing/workflow-interaction.tsx";
import { PricingPlanGrid } from "../pricing/pricing-plan-card.tsx";
import { PageKicker, formatCount, formatMonthlyPrice } from "./shared.tsx";

const appLogos = [
  { name: "Gmail", src: "/logos/gmail.svg", href: "https://mail.google.com/" },
  { name: "Slack", src: "/logos/slack.svg", href: "https://slack.com/" },
  { name: "Notion", src: "/logos/notion.svg", href: "https://www.notion.com/" },
  { name: "Linear", src: "/logos/linear.svg", href: "https://linear.app/" },
  { name: "Chrome", src: "/logos/chrome.svg", href: "https://www.google.com/chrome/" },
  { name: "WhatsApp", src: "/logos/whatsapp.svg", href: "https://www.whatsapp.com/" },
  { name: "Ghostty", src: "/logos/ghostty.svg", href: "https://ghostty.org/" },
  { name: "Messages", src: "/logos/messages.svg", href: "https://www.apple.com/ios/messages/" },
  { name: "Discord", src: "/logos/discord.svg", href: "https://discord.com/" },
  { name: "VS Code", src: "/logos/vscode.svg", href: "https://code.visualstudio.com/" },
  { name: "Obsidian", src: "/logos/obsidian.svg", href: "https://obsidian.md/" },
  { name: "Zed", src: "/logos/zed.svg", href: "https://zed.dev/" },
] as const;

function AppIcon({ src, className, glyphClassName }: { src: string; className: string; glyphClassName: string }) {
  return (
    <span className={cn("grid place-items-center bg-[var(--tab-app-icon-bg)]", className)} aria-hidden="true">
      <span
        className={cn("tab-app-icon-glyph block", glyphClassName)}
        style={{ "--tab-app-icon-mask": `url("${src}")` } as CSSProperties}
      />
    </span>
  );
}

const steps = [
  {
    number: "01",
    title: "Keep typing",
    description: "Tab uses recent Typing Context from the active text field to prepare the next short phrase.",
  },
  {
    number: "02",
    title: "Press Option+Tab",
    description: "Accept the current Suggestion without leaving the keyboard. Nothing changes until you act.",
  },
  {
    number: "03",
    title: "Keep going",
    description: "The inserted phrase becomes context for the next Suggestion. Repeat, or keep typing to ignore it.",
  },
] as const;

const trustPoints = [
  {
    icon: ShieldCheck,
    title: "Automatic Suggestions stay local",
    description: "They run on your Mac without sending Typing Context to Tab.",
  },
  {
    icon: CheckCircle,
    title: "Cloud only when you ask",
    description: "Deep Complete sends bounded, redacted context after you double-tap Option.",
  },
  {
    icon: Brain,
    title: "Personal Memory stays visible",
    description: "Add, edit, export, or delete saved details from your account.",
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
    question: "Where does Tab work?",
    answer: "Tab is designed for standard text fields across macOS. Compatibility can vary in custom editors.",
  },
  {
    question: "What leaves my Mac?",
    answer: "Automatic Suggestions run locally. Deep Complete sends bounded, redacted context only when you double-tap Option.",
  },
  {
    question: "What happens after the trial?",
    answer: "Your paid subscription begins automatically when the free month ends unless you cancel first. Polar collects payment details at checkout and sends a reminder before the trial converts.",
  },
  {
    question: "What happens to Personal Memory if I cancel?",
    answer: "You can still view, edit, export, and delete existing Personal Memory.",
  },
] as const;

function AppMarquee() {
  return (
    <div id="app-marquee-animation" className="tab-app-marquee" aria-labelledby="app-marquee-title" role="region">
      <div className="mb-5">
        <p id="app-marquee-title" className="text-sm font-semibold text-muted-foreground">Supported app examples</p>
      </div>
      <div className="tab-app-marquee-viewport overflow-hidden">
        <div className="tab-app-marquee-track flex w-max items-center">
          {[false, true].map((duplicate) => (
            <div className={cn("flex items-center gap-7 pr-7", duplicate ? "tab-app-marquee-copy" : "tab-app-marquee-group")} aria-hidden={duplicate || undefined} key={String(duplicate)}>
              {appLogos.map((app) => (
                <a className="flex items-center gap-3 whitespace-nowrap rounded-[var(--radius-control)] text-sm font-semibold transition-[background-color,transform] duration-150 ease-[var(--tab-ease-out)] hover:bg-[var(--tab-hover)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={app.href} target="_blank" rel="noreferrer" tabIndex={duplicate ? -1 : undefined} key={app.name}>
                  <AppIcon className="size-9 rounded-[var(--radius-media)] border border-border" glyphClassName="size-4" src={app.src} />
                  {app.name}
                </a>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WorkflowMap() {
  const incomingLeft = "M380 76V112C380 137 318 149 250 149H132V164";
  const incomingRight = "M380 76V112C380 137 442 149 510 149H628V164";
  const outgoingLeft = "M132 206V228C132 252 228 266 315 266H342";
  const outgoingRight = "M628 206V228C628 252 532 266 445 266H418";
  const paths = [
    { path: incomingLeft, duration: "3.2s" },
    { path: incomingRight, duration: "3.2s" },
    { path: outgoingLeft, duration: "2.486s" },
    { path: outgoingRight, duration: "2.486s" },
  ];

  return (
    <WorkflowInteraction id="workflow-animation" className="tab-workflow overflow-hidden rounded-[var(--radius-surface)] border border-border bg-card">
      <div className="flex items-center justify-between gap-4 border-b border-border bg-muted/30 px-4 py-3 sm:px-5">
        <div><p className="text-sm font-bold">The Acceptance loop</p><p className="text-xs text-muted-foreground">Each inserted phrase makes room for the next</p></div>
        <MotionToggle controls="workflow-animation" />
      </div>
      <div className="tab-workflow-map relative isolate min-h-[19rem] overflow-hidden bg-[var(--tab-surface-sunken)] sm:min-h-[23rem]">
        <svg className="absolute inset-0 size-full text-border" viewBox="0 0 760 340" preserveAspectRatio="none" aria-hidden="true">
          {paths.map(({ path }) => <path className="tab-workflow-line" d={path} fill="none" stroke="currentColor" key={path} />)}
          {paths.map(({ path, duration }) => (
            <path className="tab-workflow-signal text-foreground" d="M0 0h0.001" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="8" vectorEffect="non-scaling-stroke" key={`signal-${path}`}>
              <animateMotion begin="0s" dur={duration} repeatCount="indefinite" path={path} />
            </path>
          ))}
        </svg>

        <div className="absolute left-1/2 top-[7%] w-[min(76%,23rem)] -translate-x-1/2 rounded-[var(--radius-card)] border border-border bg-card p-3 shadow-[var(--tab-shadow-card)] sm:p-4">
          <p className="font-[var(--font-code)] text-[0.625rem] font-semibold uppercase text-muted-foreground">Your thought</p>
          <p className="mt-1 text-sm font-semibold leading-snug sm:text-base">Would Tuesday afternoon<span className="tab-workflow-fragment" data-workflow-fragment="0"> work for a review?</span><span className="tab-workflow-fragment" data-workflow-fragment="1"> I'll send the draft.</span><span className="tab-workflow-fragment" data-workflow-fragment="2"> Does 2 PM work?</span></p>
        </div>

        {[{ name: "Mail", src: "/logos/apple.svg", side: "left-[7%]" }, { name: "Slack", src: "/logos/slack.svg", side: "right-[7%]" }].map((app) => (
          <div className={cn("absolute top-[42%] flex w-[34%] max-w-40 items-center gap-2 rounded-[var(--radius-card)] border border-border bg-card p-2 shadow-[var(--tab-shadow-card)] min-[420px]:top-[40%] min-[420px]:w-[28%] sm:gap-3 sm:p-3", app.side)} key={app.name}>
            <AppIcon className="size-7 shrink-0 rounded-[var(--radius-media)] border border-border sm:size-8" glyphClassName="size-3.5 sm:size-4" src={app.src} />
            <span className="min-w-0"><span className="block text-xs font-bold min-[360px]:text-sm">{app.name}</span><span className="hidden truncate text-xs text-muted-foreground min-[460px]:block">Active app</span></span>
          </div>
        ))}

        <div className="absolute bottom-[10%] left-1/2 w-[min(86%,33rem)] -translate-x-1/2">
          <SuggestionCommand
            aria-label="Accept the workflow suggestion with Option plus Tab"
            className="tab-workflow-command"
            data-workflow-accept
            suggestion={(
              <>
                <span className="tab-workflow-command-label" data-workflow-command-label="0">work for a review?</span>
                <span className="tab-workflow-command-label" data-workflow-command-label="1">I'll send the draft.</span>
                <span className="tab-workflow-command-label" data-workflow-command-label="2">Does 2 PM work?</span>
              </>
            )}
          />
        </div>
      </div>

      <ol className="grid border-t border-border md:grid-cols-3">
        {steps.map((step) => (
          <li className="grid min-h-44 content-between gap-7 border-b border-border p-5 last:border-b-0 md:border-b-0 md:border-l md:first:border-l-0 md:p-6" key={step.number}>
            <span className="font-[var(--font-code)] text-xs font-semibold text-muted-foreground">{step.number}</span>
            <div>
              <h3 className="text-lg font-bold">{step.title}</h3>
              <p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">{step.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </WorkflowInteraction>
  );
}

function MemoryShowcase() {
  return (
    <section id="personal-memory" className="scroll-mt-24 py-20 sm:py-28">
      <div className="max-w-3xl">
        <PageKicker>Personal Memory</PageKicker>
        <h2 className="mt-4 max-w-[13ch] text-balance font-[var(--font-display)] text-[clamp(2.5rem,5vw,4.75rem)] font-bold leading-[0.96] tracking-[-0.03em]">Useful details, ready for the next phrase.</h2>
        <p className="mt-6 max-w-[42rem] text-pretty text-lg leading-relaxed text-muted-foreground">When a saved detail matches what you are writing, Tab can use it to make the suggestion more relevant. Every memory remains visible and editable.</p>
      </div>

      <div id="memory-showcase-animation" className="mt-12 overflow-hidden rounded-[var(--radius-surface)] border border-border bg-card shadow-[var(--tab-shadow-card)]" data-animated-showcase data-restarting="false" data-motion-region data-motion-paused="false">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-muted/30 px-4 py-3 sm:px-5">
          <div><p className="text-sm font-bold">Memory in context</p><p className="text-xs text-muted-foreground">A matching detail shapes the suggestion</p></div>
          <div className="flex shrink-0 items-center gap-1">
            <MotionToggle controls="memory-showcase-animation" />
            <ReplayButton showcase />
          </div>
        </div>

        <div className="tab-showcase-canvas grid items-center gap-5 p-5 md:grid-cols-[minmax(0,0.9fr)_4rem_minmax(0,1.1fr)] md:p-10 lg:gap-8 lg:p-14">
          <div className="rounded-[var(--radius-card)] border border-border bg-background shadow-[var(--tab-shadow-card)]">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div><p className="text-sm font-bold">Personal Memory</p><p className="text-xs text-muted-foreground">Saved details</p></div>
              <Badge variant="secondary" className="font-[var(--font-code)] text-[0.625rem] text-muted-foreground">3 active</Badge>
            </div>
            <div className="grid gap-1 p-2">
              {memoryExamples.map((example, index) => (
                <div className="tab-memory-row flex items-start justify-between gap-3 rounded-[var(--radius-control)] border border-transparent px-3 py-3" key={example.memory}>
                  <div className="flex gap-2.5"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--success)]" /><p className="text-sm leading-relaxed">{example.memory}</p></div>
                  <span className="font-[var(--font-code)] text-[0.625rem] text-muted-foreground">0{index + 1}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="relative mx-auto h-12 w-px bg-border md:h-px md:w-full" aria-hidden="true"><span className="tab-memory-transfer-dot absolute size-2 rounded-full bg-foreground" /></div>

          <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-background shadow-[var(--tab-shadow-card)]">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div><p className="text-sm font-bold">Current draft</p><p className="text-xs text-muted-foreground">Mail</p></div>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><span className="size-1.5 rounded-full bg-[var(--success)]" /> Memory on</span>
            </div>
            <div className="relative min-h-52 p-4 sm:min-h-48 sm:p-5" aria-hidden="true">
              {memoryExamples.map((example) => (
                <div className="tab-memory-output absolute inset-4 grid content-between gap-6 sm:inset-5" key={example.memory}>
                  <div>
                    <p className="font-[var(--font-code)] text-[0.625rem] font-semibold uppercase text-muted-foreground">{example.context}</p>
                    <p className="mt-4 text-lg leading-8">{example.lead} <span className="text-muted-foreground">{example.suggestion}</span></p>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border bg-[var(--tab-success-tint)] px-3 py-2 text-xs">
                    <span className="truncate font-semibold">Used: {example.memory}</span>
                    <span className="shrink-0 font-[var(--font-code)] text-muted-foreground">Relevant</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function PrivacyPipeline() {
  return (
    <section id="privacy" className="scroll-mt-24 py-20 sm:py-28" aria-labelledby="trust-heading">
      <div className="max-w-3xl">
        <PageKicker>Privacy and control</PageKicker>
        <h2 id="trust-heading" className="mt-4 max-w-[14ch] text-balance font-[var(--font-display)] text-[clamp(2.5rem,5vw,4.75rem)] font-bold leading-[0.96] tracking-[-0.03em]">Local unless you ask for the cloud.</h2>
        <p className="mt-6 max-w-[42rem] text-pretty text-lg leading-relaxed text-muted-foreground">Automatic Suggestions stay on your Mac. Deep Complete sends bounded, redacted context only after you double-tap Option.</p>
      </div>

      <div id="privacy-showcase-animation" className="mt-12 overflow-hidden rounded-[var(--radius-surface)] border border-border bg-card shadow-[var(--tab-shadow-card)]" data-animated-showcase data-restarting="false" data-motion-region data-motion-paused="false">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-muted/30 px-4 py-3 sm:px-5">
          <div><p className="text-sm font-bold">Deep Complete boundary</p><p className="text-xs text-muted-foreground">What moves after your explicit action</p></div>
          <div className="flex shrink-0 items-center gap-1">
            <MotionToggle controls="privacy-showcase-animation" />
            <ReplayButton showcase />
          </div>
        </div>

        <div className="tab-showcase-canvas grid items-center gap-4 p-5 md:grid-cols-[minmax(0,1fr)_3rem_minmax(0,0.9fr)_3rem_minmax(0,1fr)] md:p-8 lg:gap-6 lg:p-12">
          <div className="rounded-[var(--radius-card)] border border-border bg-background p-4 shadow-[var(--tab-shadow-card)] sm:p-5">
            <div className="flex items-center justify-between gap-3"><p className="text-sm font-bold">Recent typing context</p><span className="font-[var(--font-code)] text-[0.625rem] text-muted-foreground">On this Mac</span></div>
            <div className="mt-5 rounded-[var(--radius-control)] border border-border bg-muted/35 p-3 font-[var(--font-code)] text-xs leading-6">
              <p>Send the launch notes to Maya</p>
              <p className="text-muted-foreground">token: <span className="rounded bg-[var(--tab-destructive-tint)] px-1.5 py-0.5 text-destructive">[REDACTED]</span></p>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">Navigation, shortcuts, and passive app content are not Typing Context.</p>
          </div>

          <div className="relative mx-auto h-10 w-px bg-border md:h-px md:w-full" aria-hidden="true"><span className="tab-privacy-transfer-dot absolute size-2 rounded-full bg-foreground" /></div>

          <div className="rounded-[var(--radius-card)] border border-border bg-background p-4 shadow-[var(--tab-shadow-card)] sm:p-5">
            <p className="text-sm font-bold">Local guardrails</p>
            <div className="mt-4 grid gap-2">
              {["Secure input suppressed", "Secrets redacted locally", "Context bounded"].map((check) => (
                <div className="tab-privacy-check flex items-center gap-2 rounded-[var(--radius-control)] border border-border px-3 py-2.5 text-xs font-semibold" key={check}><CheckCircle aria-hidden="true" /> {check}</div>
              ))}
            </div>
          </div>

          <div className="relative mx-auto h-10 w-px bg-border md:h-px md:w-full" aria-hidden="true"><span className="tab-privacy-transfer-dot tab-privacy-transfer-dot-delayed absolute size-2 rounded-full bg-foreground" /></div>

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
      </div>

      <div className="mt-12 grid gap-10 md:grid-cols-3 md:gap-12">
        {trustPoints.map((point) => {
          const Icon = point.icon;
          return (
            <article key={point.title}>
              <Icon className="size-5" aria-hidden="true" />
              <h3 className="mt-5 text-lg font-bold">{point.title}</h3>
              <p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">{point.description}</p>
            </article>
          );
        })}
      </div>
      <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold">
        <a className="tab-action-link" href="/privacy">Read the privacy policy <ArrowRight aria-hidden="true" /></a>
        <a className="tab-action-link tab-action-link-external" href="https://github.com/crafter-station/tab" target="_blank" rel="noreferrer">Inspect the source <ArrowUpRight aria-hidden="true" /></a>
      </div>
    </section>
  );
}

export function HomePage() {
  const free = planCapabilities.free;
  const pro = planCapabilities.pro;
  const max = planCapabilities.max;
  const pricingPlans = [
    {
      name: "Free" as const,
      price: "$0",
      billing: "No subscription required.",
      badge: "No subscription",
      features: [
        `${formatCount(free.localAcceptedWordsPerDay)} Accepted Words each day`,
        `${free.deepCompletesPerMonth} Deep Completes each month`,
        `${free.personalDeviceLimit} Mac`,
        "Manage existing Personal Memory",
      ],
      action: { kind: "link" as const, href: "/signup", label: "Create a Free account" },
    },
    {
      name: "Pro" as const,
      price: formatMonthlyPrice(pro.monthlyPriceUsd),
      billing: "Billed monthly",
      badge: "Best for daily use",
      features: [
        "Unlimited Accepted Words",
        `${pro.deepCompletesPerMonth} Deep Completes each month`,
        `Up to ${pro.personalDeviceLimit} Macs`,
        "Continuous Memory Extraction",
      ],
      action: { kind: "link" as const, href: "/pricing", label: "Start Pro with one month free" },
      featured: true,
    },
    {
      name: "Max" as const,
      price: formatMonthlyPrice(max.monthlyPriceUsd),
      billing: "Billed monthly",
      badge: "Most Deep Completes",
      features: [
        "Unlimited Accepted Words",
        `${formatCount(max.deepCompletesPerMonth)} Deep Completes each month`,
        `Up to ${max.personalDeviceLimit} Macs`,
        "Continuous Memory Extraction",
      ],
      action: { kind: "link" as const, href: "/pricing", label: "Start Max with one month free" },
    },
  ];

  return (
    <MarketingInteractionProvider>
      <section className="grid gap-12 py-10 lg:grid-cols-[minmax(0,0.88fr)_minmax(31rem,1.12fr)] lg:items-center lg:gap-16 lg:py-20">
        <div className="marketing-intro grid content-center gap-6">
          <PageKicker>Autocomplete across your Mac</PageKicker>
          <h1 className="max-w-[11ch] text-balance font-[var(--font-display)] text-[clamp(2.625rem,7vw,6.4rem)] font-bold leading-[0.96] tracking-[-0.035em] sm:leading-[0.9] lg:leading-[0.88]">Keep the thought moving without leaving the app.</h1>
          <p className="max-w-[38rem] text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl">Tab suggests the next phrase in supported Mac text fields. Press Option+Tab to insert it, then again for the next. Keep typing whenever you want to ignore one.</p>
          <p className="max-w-[38rem] text-pretty text-sm leading-relaxed text-muted-foreground">Automatic Suggestions run on your Mac. Double-tap Option when you want Deep Complete.</p>
          <div className="flex flex-col gap-3 min-[420px]:flex-row">
            <Button asChild size="lg"><a href="/download/tab.dmg"><DownloadSimple data-icon="inline-start" aria-hidden="true" />Download for Mac</a></Button>
            <Button asChild variant="secondary" size="lg"><a href="#how-it-works">See how it works<ArrowRight data-icon="inline-end" aria-hidden="true" /></a></Button>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><CheckCircle aria-hidden="true" /> First month free on paid plans</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle aria-hidden="true" /> Payment details required</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle aria-hidden="true" /> Cancel before billing starts</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle aria-hidden="true" /> You choose every insertion</span>
          </div>
        </div>
        <div id="demo" className="scroll-mt-24">
          <AutocompleteDemo />
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-24 py-20 sm:py-28">
        <div className="max-w-3xl">
          <PageKicker>How it works</PageKicker>
          <h2 className="mt-4 max-w-[14ch] text-balance font-[var(--font-display)] text-[clamp(2.5rem,5vw,4.75rem)] font-bold leading-[0.96] tracking-[-0.03em]">One shortcut. Then the next Suggestion.</h2>
        </div>
        <div className="mt-12"><WorkflowMap /></div>
      </section>

      <section id="deep-complete" className="scroll-mt-24 py-20 sm:py-28">
        <div className="max-w-3xl">
          <PageKicker>When the next words are not enough</PageKicker>
          <h2 className="mt-4 max-w-[14ch] text-balance font-[var(--font-display)] text-[clamp(2.5rem,5vw,4.75rem)] font-bold leading-[0.96] tracking-[-0.03em]">Keep tapping. Go deeper when you need to.</h2>
          <p className="mt-6 max-w-[42rem] text-pretty text-lg leading-relaxed text-muted-foreground">Use Option+Tab repeatedly for the next phrase. Double-tap Option when the thought needs more context, then accept the Deep Complete Suggestion with Option+Tab.</p>
        </div>
        <div className="mt-12"><DeepCompleteDemo /></div>
        <div className="mt-8 grid gap-6 border-y border-border py-6 sm:grid-cols-3">
          <div><p className="font-[var(--font-code)] text-[0.625rem] font-semibold uppercase text-muted-foreground">Automatic</p><p className="mt-2 text-sm font-semibold">A Local Suggestion appears after a short pause.</p></div>
          <div><p className="font-[var(--font-code)] text-[0.625rem] font-semibold uppercase text-muted-foreground">Explicit</p><p className="mt-2 text-sm font-semibold">Double-tap Option to request Deep Complete.</p></div>
          <div><p className="font-[var(--font-code)] text-[0.625rem] font-semibold uppercase text-muted-foreground">One acceptance key</p><p className="mt-2 text-sm font-semibold">Option+Tab inserts either kind of Suggestion.</p></div>
        </div>
      </section>

      <section id="compatibility" className="scroll-mt-24 rounded-[var(--radius-surface)] bg-muted/35 px-5 py-10 sm:px-8 sm:py-12 lg:px-12">
        <div className="max-w-3xl">
          <PageKicker>Compatibility</PageKicker>
          <h2 className="mt-4 text-balance font-[var(--font-display)] text-3xl font-bold tracking-[-0.02em] sm:text-4xl">Built for standard Mac text fields.</h2>
          <p className="mt-4 max-w-[40rem] text-pretty leading-relaxed text-muted-foreground">Use Tab in supported writing surfaces such as Mail, Slack, Notes, and terminals. Some custom editors may behave differently.</p>
        </div>
        <div className="mt-10"><AppMarquee /></div>
      </section>

      <MemoryShowcase />
      <PrivacyPipeline />

      <section id="pricing" className="scroll-mt-24 rounded-[var(--radius-surface)] bg-muted/35 px-5 py-12 sm:px-8 sm:py-16 lg:px-12">
        <div className="max-w-3xl">
          <PageKicker>One month free</PageKicker>
          <h2 className="mt-4 max-w-[13ch] text-balance font-[var(--font-display)] text-4xl font-bold leading-tight tracking-[-0.02em] sm:text-5xl">Try Pro or Max before the first charge.</h2>
          <p className="mt-5 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">Start either paid plan through secure Polar checkout. Your subscription begins after the free month unless you cancel first.</p>
        </div>

        <PricingPlanGrid className="mt-12" plans={pricingPlans} />
        <div className="mt-8 flex flex-col justify-between gap-4 text-sm leading-relaxed text-muted-foreground sm:flex-row sm:items-center">
          <p>Free counts only words you insert. There are no automatic overage charges.</p>
          <a className="tab-action-link shrink-0 font-semibold text-foreground" href="/pricing">Compare full plan details <ArrowRight aria-hidden="true" /></a>
        </div>
      </section>

      <section className="py-20 sm:py-28">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.65fr)_minmax(0,1.35fr)] lg:gap-20">
          <div>
            <PageKicker>Questions</PageKicker>
            <h2 className="mt-4 text-balance font-[var(--font-display)] text-4xl font-bold leading-tight tracking-[-0.015em]">Know before you install.</h2>
          </div>
          <div>
            {faqs.map((faq) => (
              <details className="marketing-detail group border-b border-border first:border-t" key={faq.question}>
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

      <section className="pb-16 pt-4 sm:pb-24 sm:pt-8">
        <div className="grid gap-8 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <p className="font-[var(--font-code)] text-xs font-semibold uppercase text-muted-foreground">Ready to try it?</p>
            <h2 className="mt-4 max-w-[13ch] text-balance font-[var(--font-display)] text-[clamp(2.75rem,6vw,5.5rem)] font-bold leading-[0.92] tracking-[-0.035em]">Try Tab in your next sentence.</h2>
          </div>
          <Button asChild size="lg"><a href="/download/tab.dmg"><DownloadSimple data-icon="inline-start" aria-hidden="true" /> Download for Mac</a></Button>
        </div>
      </section>
    </MarketingInteractionProvider>
  );
}
