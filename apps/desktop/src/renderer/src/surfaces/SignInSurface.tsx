import { useState } from "react";
import { Button } from "@tabb/ui";

const heroImage = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 1100">
  <defs>
    <radialGradient id="glow" cx="30%" cy="12%" r="75%">
      <stop offset="0" stop-color="#f2d86a" stop-opacity="0.92"/>
      <stop offset="0.38" stop-color="#6e5b1b" stop-opacity="0.46"/>
      <stop offset="1" stop-color="#11110f"/>
    </radialGradient>
    <linearGradient id="card" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff7c2" stop-opacity="0.24"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.04"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="30" stdDeviation="28" flood-color="#000000" flood-opacity="0.45"/>
    </filter>
  </defs>
  <rect width="900" height="1100" fill="url(#glow)"/>
  <g opacity="0.34" stroke="#fff2a8" stroke-width="1">
    <path d="M96 920 C252 748 336 756 492 584 S724 332 828 196" fill="none"/>
    <path d="M42 802 C248 664 304 548 470 450 S670 284 804 84" fill="none"/>
    <path d="M162 1018 C244 888 366 820 518 748 S760 600 878 410" fill="none"/>
  </g>
  <g filter="url(#shadow)">
    <rect x="196" y="264" width="508" height="572" rx="54" fill="url(#card)" stroke="#fff6bf" stroke-opacity="0.22"/>
    <rect x="254" y="338" width="282" height="34" rx="17" fill="#fff7c2" fill-opacity="0.86"/>
    <rect x="254" y="406" width="392" height="22" rx="11" fill="#ffffff" fill-opacity="0.28"/>
    <rect x="254" y="452" width="326" height="22" rx="11" fill="#ffffff" fill-opacity="0.18"/>
    <rect x="254" y="534" width="392" height="92" rx="28" fill="#11110f" fill-opacity="0.58" stroke="#fff6bf" stroke-opacity="0.18"/>
    <rect x="292" y="570" width="236" height="20" rx="10" fill="#f2d86a" fill-opacity="0.74"/>
    <circle cx="602" cy="580" r="21" fill="#f2d86a"/>
    <path d="M593 580h18M602 571v18" stroke="#17140a" stroke-width="5" stroke-linecap="round"/>
    <rect x="254" y="676" width="214" height="58" rx="29" fill="#f2d86a"/>
  </g>
</svg>
`)}`;

export function SignInSurface() {
  const [opened, setOpened] = useState(false);

  function handleSignIn() {
    setOpened(true);
    window.tabb?.signIn?.();
  }

  return (
    <main className="sign-in-shell">
      <section className="sign-in-hero drag-region" aria-label="Tabb preview">
        <img alt="Tabb assistant preview" draggable={false} src={heroImage} />
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
