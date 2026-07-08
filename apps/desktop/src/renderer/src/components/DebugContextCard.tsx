import { cn } from "@tab/ui";

type DebugApiState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "empty" }
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
    fragmentCount: number;
    messageCount: number;
  };
  api?: DebugApiState;
};

type DebugContextCardProps = {
  debug: DebugContext | null;
};

function getApiText(api: DebugApiState | undefined): string {
  if (!api || api.status === "idle") return "Waiting for debounce...";
  if (api.status === "loading") return "Requesting next tokens...";
  if (api.status === "empty") return "No suggestion returned yet.";
  return api.text;
}

export function DebugContextCard({ debug }: DebugContextCardProps) {
  const api = debug?.api;
  const appContext = debug?.appContext;
  const meta = debug
    ? `last ${debug.wordCount}/${debug.wordLimit} words · ${debug.source} · ${debug.app || "no active app"}${debug.secureInput ? " · secure input" : ""}${debug.paused ? " · paused" : ""}`
    : "";
  const appContextText = appContext
    ? `${appContext.provider ?? "unknown provider"} · ${appContext.status} · confidence ${appContext.confidence ?? "n/a"} · ${appContext.fragmentCount} fragments · ${appContext.messageCount} messages`
    : "No suggestion-only App Context";

  return (
    <section className={cn("debug-card", debug && "debug-card--visible")} aria-hidden={!debug}>
      <div className="debug-card__label">Dev typing context</div>
      <div className="debug-card__grid">
        <div>
          <div className="debug-card__section-label">Captured input</div>
          <div className="debug-card__body">{debug?.context || "No captured typing context"}</div>
        </div>
        <div>
          <div className="debug-card__section-label">API response</div>
          <div className={cn("debug-card__api", api?.status !== "suggestion" && "debug-card__api--muted")}>
            {getApiText(api)}
          </div>
        </div>
        <div>
          <div className="debug-card__section-label">App Context</div>
          <div className="debug-card__api debug-card__api--muted">{appContextText}</div>
        </div>
      </div>
      <div className="debug-card__meta">{meta}</div>
    </section>
  );
}
