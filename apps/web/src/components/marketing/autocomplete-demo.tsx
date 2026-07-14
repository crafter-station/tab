import { SuggestionCommand, Tabs, TabsContent, TabsList, TabsTrigger } from "@tab/ui";
import { useEffect, useRef, useState } from "react";
import { ReplayButton } from "./controls.tsx";
import { useAcceptanceSurface } from "./interaction-provider.tsx";

const examples = ["mail", "slack", "notes"] as const;
type Example = (typeof examples)[number];

const suggestions: Record<Example, readonly string[]> = {
  mail: ["Would Tuesday afternoon", "work for a quick review?", "I can send the final draft beforehand."],
  slack: ["The new onboarding flow is ready", "for a final pass", "before we ship."],
  notes: ["update the release checklist", "notify the support team", "and schedule the announcement."],
};

function AppIcon({ app }: { app: Example }) {
  const src = app === "slack" ? "/logos/slack.svg" : "/logos/apple.svg";
  return (
    <span className="grid size-5 place-items-center rounded-sm bg-[var(--tab-app-icon-bg)]" aria-hidden="true">
      <span className="tab-app-icon-glyph block size-3" style={{ "--tab-app-icon-mask": `url("${src}")` } as React.CSSProperties} />
    </span>
  );
}

function DraftText({ app, step }: { app: Example; step: number }) {
  return (
    <p className="mt-4 text-[1.025rem] leading-8 sm:text-lg">
      {app === "mail" ? "I finished the launch notes." : null}
      {app === "slack" ? "Quick update:" : null}
      {app === "notes" ? "Before launch, remember to" : null}
      {suggestions[app].map((suggestion, index) => index <= step ? (
        <span className={index === step ? "tab-demo-suggestion text-muted-foreground" : "tab-demo-inserted"} key={suggestion}>{" "}{suggestion}</span>
      ) : null)}
    </p>
  );
}

function DemoScene({ name, step, children }: { name: Example; step: number; children: React.ReactNode }) {
  const currentSuggestion = suggestions[name][step];
  return (
    <TabsContent className="m-0 min-h-[19rem] content-between gap-8 p-5 sm:min-h-[22rem] sm:p-7" forceMount value={name} data-demo-scene={name}>
      <div>
        {children}
        <DraftText app={name} step={step} />
      </div>
      <div className="grid gap-2.5">
        <div className="flex items-center justify-between gap-3 px-0.5 font-[var(--font-code)] text-[0.625rem] font-semibold uppercase text-muted-foreground">
          <span>{currentSuggestion ? `Suggestion ${step + 1} of ${suggestions[name].length}` : "Thought complete"}</span>
          <span>{step} accepted</span>
        </div>
        <SuggestionCommand
          aria-label={currentSuggestion ? `Accept suggestion ${step + 1} with Option plus Tab` : "Waiting for the next suggestion"}
          className="tab-demo-overlay"
          data-demo-accept
          disabled={!currentSuggestion}
          suggestion={currentSuggestion ?? ""}
        />
      </div>
    </TabsContent>
  );
}

export function AutocompleteDemo() {
  const [active, setActive] = useState<Example>("mail");
  const [step, setStep] = useState(0);
  const [accepted, setAccepted] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [announcement, setAnnouncement] = useState("Suggestion one of three ready. Press Option plus Tab to accept.");
  const transitionTimer = useRef<number | undefined>(undefined);
  const restartTimer = useRef<number | undefined>(undefined);
  const accepting = useRef(false);

  const clearTimers = () => {
    window.clearTimeout(transitionTimer.current);
    window.clearTimeout(restartTimer.current);
  };

  const accept = () => {
    if (accepting.current || step >= suggestions[active].length) return;
    accepting.current = true;
    const acceptedStep = step;
    setAccepted(true);
    setAnnouncement(`Suggestion ${acceptedStep + 1} accepted.`);
    transitionTimer.current = window.setTimeout(() => {
      const nextStep = acceptedStep + 1;
      setStep(nextStep);
      setAccepted(false);
      accepting.current = false;
      if (nextStep < suggestions[active].length) {
        setAnnouncement(`Suggestion ${nextStep + 1} of ${suggestions[active].length} ready. Press Option plus Tab again.`);
        return;
      }
      setAnnouncement("Thought complete. The suggestion sequence will restart.");
      restartTimer.current = window.setTimeout(() => replay("A new suggestion sequence is ready."), 900);
    }, 140);
  };
  const surface = useAcceptanceSurface<HTMLDivElement>(accept, true);

  const replay = (message = "Suggestion one of three ready. Press Option plus Tab to accept.") => {
    clearTimers();
    accepting.current = false;
    setStep(0);
    setAccepted(false);
    setRestarting(true);
    setAnnouncement(message);
    requestAnimationFrame(() => requestAnimationFrame(() => setRestarting(false)));
  };

  const selectExample = (value: string) => {
    const next = value as Example;
    setActive(next);
    replay(`${next[0]?.toUpperCase()}${next.slice(1)} example selected. Suggestion one of three ready.`);
  };

  useEffect(() => clearTimers, []);

  return (
    <Tabs
      {...surface}
      className="tab-demo overflow-hidden rounded-[var(--radius-surface)] border border-border bg-card text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      value={active}
      onValueChange={selectExample}
      data-tab-demo
      data-active={active}
      data-accepted={accepted}
      data-restarting={restarting}
      data-step={step}
      aria-label="Interactive Tab autocomplete example"
      role="region"
      tabIndex={0}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-3 py-2.5 sm:px-4">
        <div className="flex items-center gap-1.5" aria-hidden="true"><span className="size-2.5 rounded-full bg-foreground/20" /><span className="size-2.5 rounded-full bg-foreground/[0.12]" /><span className="size-2.5 rounded-full bg-foreground/[0.08]" /></div>
        <p className="text-xs font-semibold text-muted-foreground">Interactive example: press Option+Tab three times</p>
        <ReplayButton label="Replay interactive example" onReplay={() => replay()} />
      </div>
      <div className="border-b border-border bg-[var(--tab-surface-sunken)] p-3 sm:px-4">
        <TabsList className="tab-demo-app-tabs flex h-auto w-fit max-w-full justify-start gap-1 overflow-x-auto rounded-[var(--radius-card)] border border-[var(--tab-overlay-border)] bg-[var(--tab-overlay-bg)] p-1 shadow-[var(--tab-overlay-shadow)] backdrop-blur-xl" aria-label="Choose an app example">
          {examples.map((app) => (
            <TabsTrigger className="tab-demo-app-tab min-w-fit gap-2 border border-transparent bg-transparent text-xs font-semibold capitalize text-[var(--tab-overlay-muted)] shadow-none" data-demo-target={app} key={app} value={app}>
              <AppIcon app={app} />{app}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <div className="bg-card" onClick={(event) => {
        if ((event.target as Element).closest("[data-demo-accept]")) accept();
      }}>
        <DemoScene name="mail" step={step}><div className="grid gap-2 border-b border-border pb-4 text-sm"><p className="flex gap-5"><span className="w-12 text-muted-foreground">To</span><span>Maya Chen</span></p><p className="flex gap-5"><span className="w-12 text-muted-foreground">Subject</span><span>Tuesday review</span></p></div><p className="mt-6">Hi Maya,</p></DemoScene>
        <DemoScene name="slack" step={step}><div className="flex items-center gap-3 border-b border-border pb-4"><span className="grid size-9 place-items-center rounded-[var(--radius-media)] bg-accent text-sm font-bold text-accent-foreground">P</span><div><p className="text-sm font-semibold"># product</p><p className="text-xs text-muted-foreground">8 teammates</p></div></div><p className="mt-6 font-semibold">Anthony <span className="ml-1 text-xs font-normal text-muted-foreground">10:42 AM</span></p></DemoScene>
        <DemoScene name="notes" step={step}><div className="border-b border-border pb-4"><p className="text-xl font-bold">Launch checklist</p><p className="mt-1 text-xs text-muted-foreground">Edited just now</p></div></DemoScene>
      </div>
      <p className="sr-only" aria-live="polite" data-demo-announcement>{announcement}</p>
    </Tabs>
  );
}
