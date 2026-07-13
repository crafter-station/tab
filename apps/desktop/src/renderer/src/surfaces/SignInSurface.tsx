import { useState } from "react";
import { Button, Eyebrow, TabMark } from "@tab/ui";

type SetupStep = {
  title: string;
  description: string;
};

const setupSteps: SetupStep[] = [
  {
    title: "Connect this Mac",
    description: "Sign in securely in your browser.",
  },
  {
    title: "Allow access",
    description: "Turn on Accessibility and Input Monitoring with a guided explanation.",
  },
  {
    title: "Try a Suggestion",
    description: "Practice accepting with Option+Tab before Tab runs in another app.",
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
          <Eyebrow>Tab for Mac</Eyebrow>
          <h1 className="sign-in-proof__title">Autocomplete where you already write.</h1>
          <div className="sign-in-proof__steps">
            {setupSteps.map((setupStep) => (
              <article className="sign-in-proof__step" key={setupStep.title}>
                <div>
                  <strong>{setupStep.title}</strong>
                  <span>{setupStep.description}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="sign-in-panel">
        <div className="sign-in-panel__drag drag-region" aria-hidden="true" />
        <div className="sign-in-panel__content no-drag">
          <div className="sign-in-brand">
            <TabMark />
            <div>
              <Eyebrow>Tab for Mac</Eyebrow>
              <strong>Autocomplete for Mac</strong>
            </div>
          </div>

          <div className="sign-in-copy">
            <h2>Connect this Mac to Tab.</h2>
            <p className="lede">We will open your browser and return you to Tab when you finish.</p>
          </div>

          <Button className="sign-in-cta" onClick={handleSignIn}>
            {opened ? "Open browser again" : "Continue in browser"}
          </Button>

          {opened ? <p className="sign-in-hint" role="status">Finish signing in in your browser.</p> : null}
        </div>
      </section>
    </main>
  );
}
