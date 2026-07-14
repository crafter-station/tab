import { useEffect, useRef, useState } from "react";
import type { MouseEventHandler, ReactNode } from "react";
import { cn } from "@tab/ui";
import { useAcceptanceSurface } from "./interaction-provider.tsx";

export function WorkflowInteraction({ children, className, id }: { children: ReactNode; className?: string; id: string }) {
  const [accepted, setAccepted] = useState(false);
  const [announcement, setAnnouncement] = useState("Suggestion ready. Press Option plus Tab or click to accept.");
  const timer = useRef<number | undefined>(undefined);
  const accept = () => {
    setAccepted(true);
    setAnnouncement("Suggestion accepted and added to the example.");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setAccepted(false);
      setAnnouncement("Suggestion ready. Press Option plus Tab or click to accept.");
    }, 1800);
  };
  const surface = useAcceptanceSurface<HTMLDivElement>(accept);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const handleClick: MouseEventHandler<HTMLDivElement> = (event) => {
    if ((event.target as Element).closest("[data-workflow-accept]")) accept();
  };

  return (
    <div {...surface} id={id} className={cn(className)} data-tab-workflow data-accepted={accepted} data-motion-region data-motion-paused="false" onClick={handleClick}>
      {children}
      <p className="sr-only" aria-live="polite" data-workflow-announcement>{announcement}</p>
    </div>
  );
}
