import { cn } from "@tab/ui";

type DebugApiState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "empty" }
  | { status: "local-unavailable"; reason: string }
  | { status: "suggestion"; text: string };

export type DebugContext = {
  context: string;
  wordLimit: number;
  wordCount: number;
  source: string;
  app: string | null;
  paused: boolean;
  secureInput: boolean;
  appContext?: {
    status: string;
    provider: string | null;
    confidence: number | null;
    suppressionReason?: string | null;
    fragmentCount: number;
    messageCount: number;
  };
  api?: DebugApiState;
};

type DebugContextCardProps = {
  debug: DebugContext | null;
};

function getApiText(api: DebugApiState | undefined): string {
  if (!api || api.status === "idle") return "Waiting before the next request...";
  if (api.status === "loading") return "Requesting a suggestion...";
  if (api.status === "empty") return "No suggestion returned yet.";
  if (api.status === "local-unavailable") return `Local suggestions unavailable (${api.reason}).`;
  return api.text;
}

export function DebugContextCard({ debug }: DebugContextCardProps) {
  const api = debug?.api;
  const appContext = debug?.appContext;
  const meta = debug
    ? `last ${debug.wordCount}/${debug.wordLimit} words · ${debug.source} · ${debug.app || "no active app"}${debug.secureInput ? " · secure input" : ""}${debug.paused ? " · paused" : ""}`
    : "";
  const appContextText = appContext
    ? [
        `status ${appContext.status}`,
        appContext.provider ? `provider ${appContext.provider}` : null,
        typeof appContext.confidence === "number" ? `confidence ${Math.round(appContext.confidence * 100)}%` : null,
        appContext.suppressionReason ? `suppressed ${appContext.suppressionReason}` : null,
        `${appContext.fragmentCount} fragments`,
        `${appContext.messageCount} messages`,
      ].filter(Boolean).join(" · ")
    : "No nearby app text diagnostics";

  return (
    <section className={cn("debug-card", debug && "debug-card--visible")} aria-hidden={!debug}>
      <div className="debug-card__label">Developer diagnostics</div>
      <div className="debug-card__grid">
        <div>
          <div className="debug-card__section-label">Recent typing sample</div>
          <div className="debug-card__body">{debug?.context || "No recent typing sample"}</div>
        </div>
        <div>
          <div className="debug-card__section-label">Suggestion response</div>
          <div className={cn("debug-card__api", api?.status !== "suggestion" && "debug-card__api--muted")}>
            {getApiText(api)}
          </div>
        </div>
        <div>
          <div className="debug-card__section-label">Nearby app text</div>
          <div className="debug-card__api debug-card__api--muted">{appContextText}</div>
        </div>
      </div>
      <div className="debug-card__meta">{meta}</div>
    </section>
  );
}
