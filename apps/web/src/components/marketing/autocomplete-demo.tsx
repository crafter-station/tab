import { SuggestionCommand, Tabs, TabsContent, TabsList, TabsTrigger } from "@tab/ui";
import { useState } from "react";
import { ReplayButton } from "./controls.tsx";
import { useAcceptanceSurface } from "./interaction-provider.tsx";

const examples = ["mail", "slack", "notes"] as const;
type Example = (typeof examples)[number];

function AppIcon({ app }: { app: Example }) {
  const src = app === "slack" ? "/logos/slack.svg" : "/logos/apple.svg";
  return (
    <span className="grid size-5 place-items-center rounded-sm bg-[var(--tab-app-icon-bg)]" aria-hidden="true">
      <span className="tab-app-icon-glyph block size-3" style={{ "--tab-app-icon-mask": `url("${src}")` } as React.CSSProperties} />
    </span>
  );
}

function DemoScene({ name, children }: { name: Example; children: React.ReactNode }) {
  return (
    <TabsContent className="m-0 min-h-[19rem] content-between gap-8 p-5 sm:min-h-[22rem] sm:p-7" forceMount value={name} data-demo-scene={name}>
      {children}
      <SuggestionCommand
        aria-label="Accept this suggestion with Option plus Tab"
        className="tab-demo-overlay"
        data-demo-accept
        suggestion={<><span className="tab-demo-ready-label">Suggestion ready</span><span className="tab-demo-accepted-label hidden">Suggestion added</span></>}
      />
    </TabsContent>
  );
}

export function AutocompleteDemo() {
  const [active, setActive] = useState<Example>("mail");
  const [accepted, setAccepted] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [announcement, setAnnouncement] = useState("Suggestion ready. Press Option plus Tab to accept.");
  const accept = () => {
    setAccepted((current) => {
      if (!current) setAnnouncement("Suggestion accepted and added to the example.");
      return true;
    });
  };
  const surface = useAcceptanceSurface<HTMLDivElement>(accept, true);
  const replay = (message = "Suggestion ready. Press Option plus Tab to accept.") => {
    setAccepted(false);
    setRestarting(true);
    setAnnouncement(message);
    requestAnimationFrame(() => requestAnimationFrame(() => setRestarting(false)));
  };
  const selectExample = (value: string) => {
    const next = value as Example;
    setActive(next);
    replay(`${next[0]?.toUpperCase()}${next.slice(1)} example selected. Suggestion ready. Press Option plus Tab to accept.`);
  };

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
      aria-label="Interactive Tab autocomplete example"
      role="region"
      tabIndex={0}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-3 py-2.5 sm:px-4">
        <div className="flex items-center gap-1.5" aria-hidden="true"><span className="size-2.5 rounded-full bg-foreground/20" /><span className="size-2.5 rounded-full bg-foreground/[0.12]" /><span className="size-2.5 rounded-full bg-foreground/[0.08]" /></div>
        <p className="text-xs font-semibold text-muted-foreground">Interactive example</p>
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
        <DemoScene name="mail"><div><div className="grid gap-2 border-b border-border pb-4 text-sm"><p className="flex gap-5"><span className="w-12 text-muted-foreground">To</span><span>Maya Chen</span></p><p className="flex gap-5"><span className="w-12 text-muted-foreground">Subject</span><span>Tuesday review</span></p></div><div className="pt-6 text-[1.025rem] leading-8 sm:text-lg"><p>Hi Maya,</p><p className="mt-4">I finished the launch notes. Would Tuesday afternoon <span className="tab-demo-suggestion text-muted-foreground">work for a quick review?</span></p></div></div></DemoScene>
        <DemoScene name="slack"><div><div className="flex items-center gap-3 border-b border-border pb-4"><span className="grid size-9 place-items-center rounded-[var(--radius-media)] bg-accent text-sm font-bold text-accent-foreground">P</span><div><p className="text-sm font-semibold"># product</p><p className="text-xs text-muted-foreground">8 teammates</p></div></div><div className="pt-6 text-[1.025rem] leading-8 sm:text-lg"><p className="font-semibold">Anthony <span className="ml-1 text-xs font-normal text-muted-foreground">10:42 AM</span></p><p className="mt-1">Quick update: the new onboarding flow is ready <span className="tab-demo-suggestion text-muted-foreground">for a final pass before we ship.</span></p></div></div></DemoScene>
        <DemoScene name="notes"><div><div className="border-b border-border pb-4"><p className="text-xl font-bold">Launch checklist</p><p className="mt-1 text-xs text-muted-foreground">Edited just now</p></div><div className="pt-6 text-[1.025rem] leading-8 sm:text-lg"><p>Before launch, remember to <span className="tab-demo-suggestion text-muted-foreground">update the release checklist and notify the support team.</span></p></div></div></DemoScene>
      </div>
      <p className="sr-only" aria-live="polite" data-demo-announcement>{announcement}</p>
    </Tabs>
  );
}
