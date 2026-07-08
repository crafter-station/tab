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
    title: "Browser handoff",
    description: "Sign in opens your browser and returns this Mac to Tab without changing the device-token contract.",
    badgeLabel: "Required",
    badgeTone: "warning",
  },
  {
    title: "Accessibility",
    description: "Enables focused Text Session understanding and accepted Suggestion insertion.",
    badgeLabel: "Setup step",
    badgeTone: "muted",
  },
  {
    title: "Input Monitoring",
    description: "Supports typing timing, acceptance shortcuts, and fallback Typing Context signals.",
    badgeLabel: "Setup step",
    badgeTone: "muted",
  },
  {
    title: "Privacy scope",
    description: "Typing Context stays in memory; no Screen Recording or Full Disk Access is requested.",
    badgeLabel: "Visible",
    badgeTone: "ok",
  },
  {
    title: "Practice Suggestion",
    description: "New users can accept, reject, and try mock Suggestions before Tab runs in another app.",
    badgeLabel: "Sandboxed",
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
          <p className="eyebrow">Private Utility Grid</p>
          <h2>Connect this Mac, then review setup step by step.</h2>
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
              <p className="eyebrow">Tab Desktop</p>
              <strong>Private autocomplete for your Mac</strong>
            </div>
          </div>

          <div className="sign-in-copy">
            <h1>Sign in to continue.</h1>
            <p className="lede">
              Tab opens your browser to connect this desktop app. After sign-in, new users continue through onboarding;
              returning users go straight to settings.
            </p>
          </div>

          <Button className="sign-in-cta" onClick={handleSignIn}>
            {opened ? "Waiting for browser sign-in..." : "Sign In"}
          </Button>

          {opened ? <p className="sign-in-hint">Complete sign-in in your browser, then return to Tab.</p> : null}
        </div>
      </section>
    </main>
  );
}
