import {
  ArrowClockwise,
  ArrowRight,
  ArrowUpRight,
  Brain,
  Check,
  CheckCircle,
  Command,
  DownloadSimple,
  Plus,
  ShieldCheck,
} from "@phosphor-icons/react";
import { planCapabilities } from "@tab/billing";
import { SuggestionCommand, buttonVariants, cn } from "@tab/ui";
import type { CSSProperties } from "react";
import { PageKicker, formatCount, formatMonthlyPrice } from "./shared.tsx";

const appLogos = [
  { name: "Gmail", src: "/logos/gmail.svg" },
  { name: "Slack", src: "/logos/slack.svg" },
  { name: "Notion", src: "/logos/notion.svg" },
  { name: "Linear", src: "/logos/linear.svg" },
  { name: "Chrome", src: "/logos/chrome.svg" },
  { name: "WhatsApp", src: "/logos/whatsapp.svg" },
  { name: "Ghostty", src: "/logos/ghostty.svg" },
  { name: "Messages", src: "/logos/messages.svg" },
  { name: "Discord", src: "/logos/discord.svg" },
  { name: "VS Code", src: "/logos/vscode.svg" },
  { name: "Obsidian", src: "/logos/obsidian.svg" },
  { name: "Zed", src: "/logos/zed.svg" },
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
    description: "Tab uses recent typing from the active text field to prepare a short continuation.",
  },
  {
    number: "02",
    title: "Preview the next words",
    description: "The suggestion appears separately from your draft, so nothing changes before you act.",
  },
  {
    number: "03",
    title: "Accept or ignore",
    description: "Press Option+Tab to insert it, or keep typing to dismiss it.",
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
    <div className="tab-demo overflow-hidden rounded-[var(--radius-surface)] border border-border bg-card text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" data-tab-demo data-active="mail" data-accepted="false" aria-label="Interactive Tab autocomplete example" role="region" tabIndex={0}>
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-3 py-2.5 sm:px-4">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-foreground/20" />
          <span className="size-2.5 rounded-full bg-foreground/[0.12]" />
          <span className="size-2.5 rounded-full bg-foreground/[0.08]" />
        </div>
        <p className="text-xs font-semibold text-muted-foreground">Interactive example</p>
        <button className="inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-control)] px-2 py-1 text-xs font-semibold text-muted-foreground transition-[color,transform] duration-150 ease-[var(--tab-ease-out)] hover:text-foreground active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" type="button" data-demo-replay>
          <ArrowClockwise aria-hidden="true" />
          Replay
        </button>
      </div>
      <div className="flex gap-2 border-b border-border p-3" role="tablist" aria-label="Choose an app example">
        {(["mail", "slack", "notes"] as const).map((app, index) => (
          <button className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-border bg-background px-3 py-1.5 text-xs font-semibold capitalize transition-[background-color,border-color,color,transform] duration-150 ease-[var(--tab-ease-out)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-demo-target={app} id={`demo-tab-${app}`} key={app} tabIndex={index === 0 ? 0 : -1} type="button" role="tab" aria-controls={`demo-panel-${app}`} aria-selected={index === 0}>
            <AppIcon className="size-5 rounded-sm" glyphClassName="size-3" src={app === "slack" ? "/logos/slack.svg" : "/logos/apple.svg"} />
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
    <div id="app-marquee-animation" className="tab-app-marquee" aria-labelledby="app-marquee-title" role="region" data-motion-region data-motion-paused="false">
      <div className="mb-5 flex items-center justify-between gap-4">
        <p id="app-marquee-title" className="text-sm font-semibold text-muted-foreground">Supported app examples</p>
        <MotionToggle controls="app-marquee-animation" />
      </div>
      <div className="tab-app-marquee-viewport overflow-hidden">
        <div className="tab-app-marquee-track flex w-max items-center">
          {[false, true].map((duplicate) => (
            <div className={cn("flex items-center gap-7 pr-7", duplicate ? "tab-app-marquee-copy" : "tab-app-marquee-group")} aria-hidden={duplicate || undefined} key={String(duplicate)}>
              {appLogos.map((app) => (
                <div className="flex items-center gap-3 whitespace-nowrap text-sm font-semibold" key={app.name}>
                  <AppIcon className="size-9 rounded-[var(--radius-media)] border border-border" glyphClassName="size-4" src={app.src} />
                  {app.name}
                </div>
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
  const incomingRight = "M380 112C380 137 442 149 510 149H628V164";
  const outgoingLeft = "M132 206V228C132 252 228 266 315 266H342";
  const outgoingRight = "M628 206V228C628 252 532 266 445 266H418";
  const paths = [incomingLeft, incomingRight, outgoingLeft, outgoingRight];

  return (
    <div id="workflow-animation" className="tab-workflow overflow-hidden rounded-[var(--radius-surface)] border border-border bg-card" data-tab-workflow data-accepted="false" data-motion-region data-motion-paused="false">
      <div className="flex items-center justify-between gap-4 border-b border-border bg-muted/30 px-4 py-3 sm:px-5">
        <div><p className="text-sm font-bold">Suggestion path</p><p className="text-xs text-muted-foreground">From your draft to a deliberate insertion</p></div>
        <MotionToggle controls="workflow-animation" />
      </div>
      <div className="tab-workflow-map relative isolate min-h-[19rem] overflow-hidden bg-[var(--tab-surface-sunken)] sm:min-h-[23rem]">
        <svg className="absolute inset-0 size-full text-border" viewBox="0 0 760 340" preserveAspectRatio="none" aria-hidden="true">
          {paths.map((path) => <path className="tab-workflow-line" d={path} fill="none" stroke="currentColor" key={path} />)}
          {paths.map((path, index) => (
            <circle className="tab-workflow-signal text-foreground" r="4" fill="currentColor" key={`signal-${path}`}>
              <animateMotion begin={`${index * 0.65}s`} dur="3.2s" repeatCount="indefinite" path={path} />
            </circle>
          ))}
        </svg>

        <div className="absolute left-1/2 top-[7%] w-[min(76%,23rem)] -translate-x-1/2 rounded-[var(--radius-card)] border border-border bg-card p-3 shadow-[var(--tab-shadow-card)] sm:p-4">
          <p className="font-[var(--font-code)] text-[0.625rem] font-semibold uppercase text-muted-foreground">Your thought</p>
          <p className="mt-1 truncate text-sm font-semibold sm:text-base">Would Tuesday afternoon <span className="tab-workflow-completion text-muted-foreground">work for a quick review?</span></p>
        </div>

        {[{ name: "Mail", src: "/logos/apple.svg", side: "left-[7%]" }, { name: "Slack", src: "/logos/slack.svg", side: "right-[7%]" }].map((app) => (
          <div className={cn("absolute top-[40%] flex w-[28%] max-w-40 items-center gap-2 rounded-[var(--radius-card)] border border-border bg-card p-2.5 shadow-[var(--tab-shadow-card)] sm:gap-3 sm:p-3", app.side)} key={app.name}>
            <AppIcon className="size-8 shrink-0 rounded-[var(--radius-media)] border border-border" glyphClassName="size-4" src={app.src} />
            <span className="min-w-0"><span className="block truncate text-sm font-bold">{app.name}</span><span className="hidden truncate text-xs text-muted-foreground min-[460px]:block">Active app</span></span>
          </div>
        ))}

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
          <li className="grid min-h-44 content-between gap-7 border-b border-border p-5 last:border-b-0 md:border-b-0 md:border-l md:first:border-l-0 md:p-6" key={step.number}>
            <span className="font-[var(--font-code)] text-xs font-semibold text-muted-foreground">{step.number}</span>
            <div>
              <h3 className="text-lg font-bold">{step.title}</h3>
              <p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">{step.description}</p>
              {index === 2 ? <p className="mt-4 font-[var(--font-code)] text-[0.6875rem] font-semibold"><Command aria-hidden="true" /> Try the overlay above</p> : null}
            </div>
          </li>
        ))}
      </ol>
      <p className="sr-only" aria-live="polite" data-workflow-announcement>Suggestion ready. Press Option plus Tab or click to accept.</p>
    </div>
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
            <button className="tab-showcase-replay inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-control)] px-2 py-1 text-xs font-semibold text-muted-foreground transition-[color,transform] duration-150 hover:text-foreground active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" type="button" data-showcase-replay>
              <ArrowClockwise aria-hidden="true" /> Replay
            </button>
          </div>
        </div>

        <div className="tab-showcase-canvas grid items-center gap-5 p-5 md:grid-cols-[minmax(0,0.9fr)_4rem_minmax(0,1.1fr)] md:p-10 lg:gap-8 lg:p-14">
          <div className="rounded-[var(--radius-card)] border border-border bg-background shadow-[var(--tab-shadow-card)]">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div><p className="text-sm font-bold">Personal Memory</p><p className="text-xs text-muted-foreground">Saved details</p></div>
              <span className="rounded-full border border-border bg-secondary px-2 py-1 font-[var(--font-code)] text-[0.625rem] font-semibold text-muted-foreground">3 active</span>
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
            <button className="tab-showcase-replay inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-control)] px-2 py-1 text-xs font-semibold text-muted-foreground transition-[color,transform] duration-150 hover:text-foreground active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" type="button" data-showcase-replay>
              <ArrowClockwise aria-hidden="true" /> Replay
            </button>
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
        <a className="inline-flex items-center gap-1.5 underline decoration-border underline-offset-4" href="/privacy">Read the privacy policy <ArrowRight aria-hidden="true" /></a>
        <a className="inline-flex items-center gap-1.5 underline decoration-border underline-offset-4" href="https://github.com/crafter-station/tab" target="_blank" rel="noreferrer">Inspect the source <ArrowUpRight aria-hidden="true" /></a>
      </div>
    </section>
  );
}

export function HomePage() {
  const free = planCapabilities.free;
  const pro = planCapabilities.pro;
  const max = { ...pro, monthlyPriceUsd: 20, deepCompletesPerMonth: 1_000 };

  return (
    <>
      <section className="grid gap-12 py-10 lg:grid-cols-[minmax(0,0.88fr)_minmax(31rem,1.12fr)] lg:items-center lg:gap-16 lg:py-20">
        <div className="marketing-intro grid content-center gap-6">
          <PageKicker>Autocomplete across your Mac</PageKicker>
          <h1 className="max-w-[11ch] text-balance font-[var(--font-display)] text-[clamp(3.25rem,7vw,6.4rem)] font-bold leading-[0.88] tracking-[-0.035em]">Finish the sentence without leaving the app.</h1>
          <p className="max-w-[38rem] text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl">Tab suggests the next words in supported Mac text fields. Press Option+Tab to insert them, or keep typing to ignore them.</p>
          <p className="max-w-[38rem] text-pretty text-sm leading-relaxed text-muted-foreground">Automatic Suggestions run on your Mac. Double-tap Option when you want Deep Complete.</p>
          <div className="flex flex-col gap-3 min-[420px]:flex-row">
            <a className={buttonVariants({ size: "lg" })} href="/download/tab.dmg">
              <DownloadSimple data-icon="inline-start" aria-hidden="true" />
              Download for Mac
            </a>
            <a className={buttonVariants({ variant: "secondary", size: "lg" })} href="#how-it-works">
              See how it works
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </a>
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
          <h2 className="mt-4 max-w-[14ch] text-balance font-[var(--font-display)] text-[clamp(2.5rem,5vw,4.75rem)] font-bold leading-[0.96] tracking-[-0.03em]">Three steps. No new writing workflow.</h2>
        </div>
        <div className="mt-12"><WorkflowMap /></div>
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

        <div className="mt-12 grid items-stretch gap-4 lg:grid-cols-3" data-pricing-grid>
          <article className="flex h-full flex-col rounded-[var(--radius-card)] border border-border bg-card p-6 sm:p-8" data-pricing-plan="free">
            <div className="flex min-h-7 items-center justify-between gap-3">
              <h3 className="text-xl font-bold">Free</h3>
              <span className="text-xs font-semibold text-muted-foreground">No subscription</span>
            </div>
            <p className="mt-7 font-[var(--font-display)] text-5xl font-bold tracking-[-0.02em] tabular-nums">$0</p>
            <p className="mt-2 min-h-10 text-sm leading-relaxed text-muted-foreground">No subscription required.</p>
            <ul className="mt-7 grid flex-1 gap-3 text-sm leading-relaxed text-muted-foreground">
              <li className="flex gap-2"><Check className="mt-1 shrink-0 text-foreground" aria-hidden="true" /> {formatCount(free.localAcceptedWordsPerDay)} Accepted Words each day</li>
              <li className="flex gap-2"><Check className="mt-1 shrink-0 text-foreground" aria-hidden="true" /> {free.deepCompletesPerMonth} Deep Completes each month</li>
              <li className="flex gap-2"><Check className="mt-1 shrink-0 text-foreground" aria-hidden="true" /> {free.personalDeviceLimit} Mac</li>
              <li className="flex gap-2"><Check className="mt-1 shrink-0 text-foreground" aria-hidden="true" /> Manage existing Personal Memory</li>
            </ul>
            <a className={buttonVariants({ variant: "secondary", size: "lg", className: "mt-8 w-full" })} href="/signup">Create a Free account</a>
          </article>

          <article className="flex h-full flex-col rounded-[var(--radius-card)] border border-foreground bg-foreground p-6 text-background sm:p-8" data-pricing-plan="pro">
            <div className="flex min-h-7 items-center justify-between gap-3">
              <h3 className="text-xl font-bold">Pro</h3>
              <span className="rounded-full border border-background/20 px-2.5 py-1 text-[0.6875rem] font-semibold text-background/75">Best for daily use</span>
            </div>
            <p className="mt-7 font-[var(--font-display)] text-5xl font-bold tracking-[-0.02em] tabular-nums">{formatMonthlyPrice(pro.monthlyPriceUsd)}</p>
            <p className="mt-2 min-h-10 text-sm leading-relaxed text-background/65">Billed monthly</p>
            <ul className="mt-7 grid flex-1 gap-3 text-sm leading-relaxed text-background/80">
              <li className="flex gap-2"><Check className="mt-1 shrink-0 text-background" aria-hidden="true" /> Unlimited Accepted Words</li>
              <li className="flex gap-2"><Check className="mt-1 shrink-0 text-background" aria-hidden="true" /> {pro.deepCompletesPerMonth} Deep Completes each month</li>
              <li className="flex gap-2"><Check className="mt-1 shrink-0 text-background" aria-hidden="true" /> Up to {pro.personalDeviceLimit} Macs</li>
              <li className="flex gap-2"><Check className="mt-1 shrink-0 text-background" aria-hidden="true" /> Continuous Memory Extraction</li>
            </ul>
            <a className={buttonVariants({ variant: "secondary", size: "lg", className: "mt-8 w-full" })} href="/pricing">Start Pro with one month free</a>
          </article>

          <article className="flex h-full flex-col rounded-[var(--radius-card)] border border-border bg-card p-6 sm:p-8" data-pricing-plan="max">
            <div className="flex min-h-7 items-center justify-between gap-3">
              <h3 className="text-xl font-bold">Max</h3>
              <span className="text-xs font-semibold text-muted-foreground">Most Deep Completes</span>
            </div>
            <p className="mt-7 font-[var(--font-display)] text-5xl font-bold tracking-[-0.02em] tabular-nums">{formatMonthlyPrice(max.monthlyPriceUsd)}</p>
            <p className="mt-2 min-h-10 text-sm leading-relaxed text-muted-foreground">Billed monthly</p>
            <ul className="mt-7 grid flex-1 gap-3 text-sm leading-relaxed text-muted-foreground">
              <li className="flex gap-2"><Check className="mt-1 shrink-0 text-foreground" aria-hidden="true" /> Unlimited Accepted Words</li>
              <li className="flex gap-2"><Check className="mt-1 shrink-0 text-foreground" aria-hidden="true" /> {formatCount(max.deepCompletesPerMonth)} Deep Completes each month</li>
              <li className="flex gap-2"><Check className="mt-1 shrink-0 text-foreground" aria-hidden="true" /> Up to {max.personalDeviceLimit} Macs</li>
              <li className="flex gap-2"><Check className="mt-1 shrink-0 text-foreground" aria-hidden="true" /> Continuous Memory Extraction</li>
            </ul>
            <a className={buttonVariants({ variant: "secondary", size: "lg", className: "mt-8 w-full" })} href="/pricing">Start Max with one month free</a>
          </article>
        </div>
        <div className="mt-8 flex flex-col justify-between gap-4 text-sm leading-relaxed text-muted-foreground sm:flex-row sm:items-center">
          <p>Free counts only words you insert. There are no automatic overage charges.</p>
          <a className="shrink-0 font-semibold text-foreground underline decoration-border underline-offset-4" href="/pricing">Compare full plan details</a>
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
          <a className={buttonVariants({ size: "lg" })} href="/download/tab.dmg"><DownloadSimple data-icon="inline-start" aria-hidden="true" /> Download for Mac</a>
        </div>
      </section>
      <script src="/marketing-demo.js?v=restored-motion" defer />
    </>
  );
}
