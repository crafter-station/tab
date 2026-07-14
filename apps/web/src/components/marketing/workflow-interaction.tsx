import { useEffect, useRef, useState } from "react";
import type { MouseEventHandler, ReactNode } from "react";
import { cn } from "@tab/ui";
import { useAcceptanceSurface } from "./interaction-provider.tsx";

export function WorkflowInteraction({ children, className, id }: { children: ReactNode; className?: string; id: string }) {
  const [step, setStep] = useState(0);
  const [accepted, setAccepted] = useState(false);
  const [announcement, setAnnouncement] = useState("Suggestion one of three ready. Press Option plus Tab or click to accept.");
  const timer = useRef<number | undefined>(undefined);
  const transitioning = useRef(false);
  const accept = () => {
    if (transitioning.current) return;
    transitioning.current = true;
    setAccepted(true);
    setAnnouncement(`Suggestion ${step + 1} accepted.`);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const nextStep = (step + 1) % 3;
      setStep(nextStep);
      setAccepted(false);
      transitioning.current = false;
      setAnnouncement(`Suggestion ${nextStep + 1} of three ready. Press Option plus Tab again.`);
    }, 140);
  };
  const surface = useAcceptanceSurface<HTMLDivElement>(accept);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const handleClick: MouseEventHandler<HTMLDivElement> = (event) => {
    if ((event.target as Element).closest("[data-workflow-accept]")) accept();
  };

  return (
    <div {...surface} id={id} className={cn(className)} data-tab-workflow data-accepted={accepted} data-step={step} data-motion-region data-motion-paused="false" onClick={handleClick}>
      {children}
      <p className="sr-only" aria-live="polite" data-workflow-announcement>{announcement}</p>
    </div>
  );
}
