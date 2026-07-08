import { useState } from "react";
import { Button, StatusBadge } from "@tabb/ui";

const setupSteps = [
  {
    title: "Browser handoff",
    description: "Sign in opens your browser and returns this Mac to Tabb without changing the device-token contract.",
    status: "Required",
    tone: "warning" as const,
  },
  {
    title: "Accessibility",
    description: "Enables focused Text Session understanding and accepted Suggestion insertion.",
    status: "Setup step",
    tone: "muted" as const,
  },
  {
    title: "Input Monitoring",
    description: "Supports typing timing, acceptance shortcuts, and fallback Typing Context signals.",
    status: "Setup step",
    tone: "muted" as const,
  },
  {
    title: "Privacy scope",
    description: "Typing Context stays in memory; no Screen Recording or Full Disk Access is requested.",
    status: "Visible",
    tone: "ok" as const,
  },
  {
    title: "Practice Suggestion",
    description: "New users can accept, reject, and try mock Suggestions before Tabb runs in another app.",
    status: "Sandboxed",
    tone: "ok" as const,
  },
];

export function SignInSurface() {
  const [opened, setOpened] = useState(false);

  function handleSignIn() {
    setOpened(true);
    window.tabb?.signIn?.();
  }

  return (
    <main className="sign-in-shell">
      <section className="sign-in-hero drag-region" aria-label="Tabb setup preview">
        <div className="sign-in-proof pug-dot-grid">
          <p className="eyebrow">Private Utility Grid</p>
          <h2>Connect this Mac, then review setup step by step.</h2>
          <div className="sign-in-proof__steps">
            {setupSteps.map((item) => (
              <article className="sign-in-proof__step" key={item.title}>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.description}</span>
                </div>
                <StatusBadge tone={item.tone}>{item.status}</StatusBadge>
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
              <p className="eyebrow">Tabb Desktop</p>
              <strong>Private autocomplete for your Mac</strong>
            </div>
          </div>

          <div className="sign-in-copy">
            <h1>Sign in to continue.</h1>
            <p className="lede">
              Tabb opens your browser to connect this desktop app. After sign-in, new users continue through onboarding;
              returning users go straight to settings.
            </p>
          </div>

          <Button className="sign-in-cta" onClick={handleSignIn}>
            {opened ? "Waiting for browser sign-in..." : "Sign In"}
          </Button>

          {opened ? <p className="sign-in-hint">Complete sign-in in your browser, then return to Tabb.</p> : null}
        </div>
      </section>
    </main>
  );
}
