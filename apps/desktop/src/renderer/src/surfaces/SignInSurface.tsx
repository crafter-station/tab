import { useState } from "react";
import { Button, StatusBadge } from "@tab/ui";
import type { StatusBadgeTone } from "@tab/ui";

type SetupStep = {
  title: string;
  description: string;
  badgeLabel: string;
  badgeTone: StatusBadgeTone;
};

const setupSteps: SetupStep[] = [
  {
    title: "Connect this Mac",
    description: "Sign in opens your browser, then returns you to Tab on this Mac.",
    badgeLabel: "Required",
    badgeTone: "warning",
  },
  {
    title: "Accessibility",
    description: "Lets Tab read the text field you are using and add suggestions you accept.",
    badgeLabel: "Setup step",
    badgeTone: "muted",
  },
  {
    title: "Input Monitoring",
    description: "Helps Tab notice typing and make Option+Tab work.",
    badgeLabel: "Setup step",
    badgeTone: "muted",
  },
  {
    title: "Privacy scope",
    description: "Tab does not request Screen Recording or Full Disk Access.",
    badgeLabel: "Visible",
    badgeTone: "ok",
  },
  {
    title: "Practice suggestion",
    description: "Try accepting and dismissing a sample suggestion before Tab runs in another app.",
    badgeLabel: "Practice",
    badgeTone: "ok",
  },
];

export function SignInSurface() {
  const [opened, setOpened] = useState(false);

  function handleSignIn() {
    setOpened(true);
    window.tab?.signIn?.();
  }

  return (
    <main className="sign-in-shell">
      <section className="sign-in-hero drag-region" aria-label="Tab setup preview">
        <div className="sign-in-proof pug-dot-grid">
          <p className="eyebrow">Tab for Mac</p>
          <p className="sign-in-proof__title">Connect this Mac, then review setup step by step.</p>
          <div className="sign-in-proof__steps">
            {setupSteps.map((setupStep) => (
              <article className="sign-in-proof__step" key={setupStep.title}>
                <div>
                  <strong>{setupStep.title}</strong>
                  <span>{setupStep.description}</span>
                </div>
                <StatusBadge tone={setupStep.badgeTone}>{setupStep.badgeLabel}</StatusBadge>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="sign-in-panel">
        <div className="sign-in-panel__drag drag-region" aria-hidden="true" />
        <div className="sign-in-panel__content no-drag">
          <div className="sign-in-brand">
            <div className="sign-in-brand__mark">T</div>
            <div>
              <p className="eyebrow">Tab for Mac</p>
              <strong>Private autocomplete for your Mac</strong>
            </div>
          </div>

          <div className="sign-in-copy">
            <h1>Sign in to continue.</h1>
            <p className="lede">
              Tab opens your browser to connect this Mac. After sign-in, new users continue through onboarding;
              returning users go straight to settings.
            </p>
          </div>

          <Button className="sign-in-cta" onClick={handleSignIn}>
            {opened ? "Waiting for browser sign-in..." : "Sign in"}
          </Button>

          {opened ? <p className="sign-in-hint">Complete sign-in in your browser, then return to Tab.</p> : null}
        </div>
      </section>
    </main>
  );
}
