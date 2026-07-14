import { ArrowClockwise, Pause, Play } from "@phosphor-icons/react";
import { Button, Toggle, cn } from "@tab/ui";
import { useEffect, useRef, useState } from "react";

function setSvgMotion(region: HTMLElement, paused: boolean) {
  region.querySelectorAll<SVGSVGElement>("svg").forEach((svg) => {
    const animationSvg = svg as SVGSVGElement & { pauseAnimations?: () => void; unpauseAnimations?: () => void };
    if (paused) animationSvg.pauseAnimations?.();
    else animationSvg.unpauseAnimations?.();
  });
}

export function MotionToggle({ controls, className }: { controls: string; className?: string }) {
  const [paused, setPaused] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const label = paused ? "Resume animation" : "Pause animation";

  useEffect(() => {
    const region = ref.current?.closest<HTMLElement>("[data-motion-region]");
    if (!region) return;
    region.dataset.motionPaused = String(paused);
    setSvgMotion(region, paused);
  }, [paused]);

  return (
    <Toggle
      ref={ref}
      className={cn("tab-motion-toggle grid size-8 p-0", className)}
      size="sm"
      pressed={paused}
      onPressedChange={setPaused}
      data-motion-toggle
      aria-controls={controls}
      aria-label={label}
      title={label}
    >
      <Pause className="tab-motion-pause-icon [grid-area:1/1]" aria-hidden="true" />
      <Play className="tab-motion-play-icon [grid-area:1/1]" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </Toggle>
  );
}

function animateReplay(control: HTMLButtonElement) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const icon = control.querySelector<SVGElement>("[data-replay-icon]");
  if (!icon?.animate) return;
  icon.getAnimations().forEach((animation) => animation.cancel());
  icon.animate(
    [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
    { duration: 420, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
  );
}

export function ReplayButton({ onReplay, label = "Replay animation", showcase = false }: { onReplay?: () => void; label?: string; showcase?: boolean }) {
  const replay = (event: React.MouseEvent<HTMLButtonElement>) => {
    animateReplay(event.currentTarget);
    const region = event.currentTarget.closest<HTMLElement>("[data-animated-showcase]");
    if (region) {
      region.dataset.restarting = "true";
      requestAnimationFrame(() => requestAnimationFrame(() => { region.dataset.restarting = "false"; }));
    }
    onReplay?.();
  };

  return (
    <Button
      className={cn(showcase && "tab-showcase-replay")}
      type="button"
      variant="ghost"
      size="icon"
      onClick={replay}
      data-demo-replay={showcase ? undefined : ""}
      data-showcase-replay={showcase ? "" : undefined}
      aria-label={label}
      title={label}
    >
      <ArrowClockwise data-replay-icon aria-hidden="true" />
    </Button>
  );
}
