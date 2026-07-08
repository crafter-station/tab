import { useCallback, useEffect, useRef, useState } from "react";
import { Button, PermissionCard, SectionCard, StatusBadge } from "@tabb/ui";
import type { DesktopStatus } from "../../../main/status";

type OnboardingStep = "sign-in" | "permissions" | "how-it-works" | "practice" | "done";

const STEPS: OnboardingStep[] = ["sign-in", "permissions", "how-it-works", "practice", "done"];
const MOCK_SUGGESTIONS = [
  "Thanks for the update - I can take a look this afternoon and follow up with next steps.",
  "That works for me. I will send the details once I confirm the timing.",
  "I appreciate the context. Let me review this and get back to you shortly.",
];

function createFallbackStatus(): DesktopStatus {
  return {
    auth: "sign_in_required",
    connectivity: "online",
    userId: null,
    quota: null,
    overlay: "hidden",
    lastUpdatedAt: null,
  };
}

function formatAuth(auth: DesktopStatus["auth"]) {
  return auth.replace(/_/g, " ");
}

function getPrimaryLabel(
  step: OnboardingStep,
  signedIn: boolean,
  accessibilityGranted: boolean,
  inputMonitoringOpened: boolean,
) {
  switch (step) {
    case "sign-in":
      return signedIn ? "Continue" : "Sign In";
    case "permissions":
      if (!accessibilityGranted) return "Open Accessibility Settings";
      if (!inputMonitoringOpened) return "Open Input Monitoring Settings";
      return "Continue";
    case "how-it-works":
      return "Practice Suggestions";
    case "practice":
      return "Finish Practice";
    case "done":
      return "Open Tabb";
  }
}

export function OnboardingSurface() {
  const [step, setStep] = useState<OnboardingStep>("sign-in");
  const [status, setStatus] = useState<DesktopStatus>(() => createFallbackStatus());
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);
  const [inputMonitoringOpened, setInputMonitoringOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [practiceText, setPracticeText] = useState("Hi Jordan, quick update on the launch plan:");
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [suggestionVisible, setSuggestionVisible] = useState(true);
  const [approvedPractice, setApprovedPractice] = useState(false);
  const [rejectedPractice, setRejectedPractice] = useState(false);
  const pollRef = useRef<number | null>(null);

  const currentStepIndex = STEPS.indexOf(step);
  const signedIn = status.auth === "signed_in";
  const practiceComplete = approvedPractice && rejectedPractice;

  const stopAccessibilityPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const setAccessibilityState = useCallback(
    (granted: boolean) => {
      setAccessibilityGranted(granted);
      if (granted) {
        setStatusMessage("Accessibility is enabled. Next, add Tabb to Input Monitoring.");
        stopAccessibilityPolling();
      }
    },
    [stopAccessibilityPolling],
  );

  const refreshAccessibilityStatus = useCallback(async () => {
    if (!window.tabb?.checkAccessibilityPermission) {
      setAccessibilityState(false);
      return false;
    }

    const granted = Boolean(await window.tabb.checkAccessibilityPermission());
    setAccessibilityState(granted);
    return granted;
  }, [setAccessibilityState]);

  const startAccessibilityPolling = useCallback(() => {
    stopAccessibilityPolling();
    pollRef.current = window.setInterval(() => {
      refreshAccessibilityStatus().catch(() => {});
    }, 1500);
  }, [refreshAccessibilityStatus, stopAccessibilityPolling]);

  useEffect(() => {
    if (!window.tabb) return;

    window.tabb.onStatusChanged((nextStatus) => setStatus(nextStatus));
    window.tabb
      .getInitialState()
      .then((initialState) => setStatus(initialState.status))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshAccessibilityStatus().catch(() => {
      setAccessibilityGranted(false);
    });

    return stopAccessibilityPolling;
  }, [refreshAccessibilityStatus, stopAccessibilityPolling]);

  async function openAccessibility() {
    setBusy(true);
    try {
      const alreadyGranted = Boolean(await window.tabb?.openAccessibilitySettings?.());
      setAccessibilityState(alreadyGranted);
      if (!alreadyGranted) {
        setStatusMessage(
          "System Settings opened to Accessibility. Turn on Tabb; this window will continue once macOS reports it is enabled.",
        );
        startAccessibilityPolling();
      }
    } finally {
      setBusy(false);
    }
  }

  async function openInputMonitoring() {
    setBusy(true);
    try {
      await window.tabb?.openInputMonitoringSettings?.();
      await window.tabb?.revealAppInFinder?.();
      setInputMonitoringOpened(true);
      setStatusMessage(
        "System Settings opened to Input Monitoring. Enable Tabb there, then relaunch Tabb if macOS does not reopen it.",
      );
    } finally {
      setBusy(false);
    }
  }

  function goNext() {
    const nextStep = STEPS[currentStepIndex + 1];
    if (nextStep) {
      setStatusMessage(null);
      setStep(nextStep);
    }
  }

  function goBack() {
    const previousStep = STEPS[currentStepIndex - 1];
    if (previousStep) {
      setStatusMessage(null);
      setStep(previousStep);
    }
  }

  async function handlePrimaryAction() {
    if (step === "sign-in") {
      if (!signedIn) {
        window.tabb?.signIn?.();
        setStatusMessage("Complete sign-in in your browser, then return here.");
        return;
      }
      goNext();
      return;
    }

    if (step === "permissions") {
      if (!accessibilityGranted) {
        await openAccessibility();
        return;
      }
      if (!inputMonitoringOpened) {
        await openInputMonitoring();
        return;
      }
      goNext();
      return;
    }

    if (step === "how-it-works") {
      goNext();
      return;
    }

    if (step === "practice") {
      if (practiceComplete) {
        goNext();
      } else {
        setStatusMessage("Accept and reject the mock suggestion once, or use Finish anyway.");
      }
      return;
    }

    window.tabb?.completeOnboarding?.();
  }

  function approveSuggestion() {
    if (!suggestionVisible) return;
    setPracticeText((value) => `${value} ${MOCK_SUGGESTIONS[suggestionIndex]}`);
    setApprovedPractice(true);
    setSuggestionVisible(false);
    setStatusMessage("Accepted. This is what Option+Tab or clicking a suggestion does in the real overlay.");
  }

  function rejectSuggestion() {
    setRejectedPractice(true);
    setSuggestionVisible(false);
    setSuggestionIndex((index) => (index + 1) % MOCK_SUGGESTIONS.length);
    setStatusMessage("Dismissed. In normal use, you can ignore stale suggestions or keep typing.");
  }

  function tryAgain() {
    setSuggestionIndex((index) => (index + 1) % MOCK_SUGGESTIONS.length);
    setSuggestionVisible(true);
    setStatusMessage(null);
  }

  const primaryLabel = getPrimaryLabel(step, signedIn, accessibilityGranted, inputMonitoringOpened);

  return (
    <main className="onboarding-shell">
      <SectionCard className="onboarding-card">
        <div className="onboarding-card__chrome drag-region" aria-hidden="true" />
        <header className="onboarding-header drag-region">
          <div>
            <p className="eyebrow">Welcome to Tabb</p>
            <h1>Set up your private typing assistant.</h1>
          </div>
          <Button className="no-drag" onClick={() => window.tabb?.skipOnboarding?.()} variant="ghost">
            Skip setup
          </Button>
        </header>

        <div className="onboarding-progress" aria-label="Setup progress">
          {STEPS.map((item, index) => (
            <span data-active={index <= currentStepIndex} key={item} />
          ))}
        </div>

        <section className="onboarding-step no-drag">
          {step === "sign-in" ? (
            <>
              <div className="onboarding-hero">
                <h2>Sign in is required before setup continues.</h2>
                <p className="lede">
                  Tabb links this Mac to your account before it requests autocomplete suggestions. You can configure permissions
                  after sign-in returns here.
                </p>
              </div>
              <div className="status-card">
                <div>
                  <strong>Account status</strong>
                  <span>{signedIn ? "Ready to continue" : "Browser sign-in required"}</span>
                </div>
                <StatusBadge tone={signedIn ? "ok" : "warning"}>{formatAuth(status.auth)}</StatusBadge>
              </div>
            </>
          ) : null}

          {step === "permissions" ? (
            <>
              <div className="onboarding-hero">
                <h2>Two permissions, no screen or file access.</h2>
                <p className="lede">
                  Tabb uses Accessibility for focused Text Session understanding and accepted Suggestion insertion, while
                  Input Monitoring supports typing timing, acceptance shortcuts, and fallback Typing Context signals.
                </p>
              </div>
              <div className="onboarding-permissions">
                <PermissionCard
                  title="Accessibility"
                  description="Supports Text Session understanding, sensitive-field checks, and accepted Suggestion insertion in the app you were using."
                  status={accessibilityGranted ? "Enabled" : "Needs access"}
                  state={accessibilityGranted ? "granted" : "pending"}
                />
                <PermissionCard
                  title="Input Monitoring"
                  description="Supports typing activity, Option+Tab acceptance, and fallback Typing Context signals when text details are unavailable."
                  status={inputMonitoringOpened ? "Confirm in System Settings" : "Relaunch may be required"}
                  state={inputMonitoringOpened ? "pending" : "manual"}
                />
              </div>
              <div className="privacy-card">
                <strong>Privacy scope</strong>
                <span>
                  Typing Context stays in memory only. Personal Memory remains visible and controlled by you, telemetry is
                  metadata-only, raw logs are not stored, and Tabb does not request Screen Recording or Full Disk Access.
                </span>
              </div>
            </>
          ) : null}

          {step === "how-it-works" ? (
            <>
              <div className="onboarding-hero">
                <h2>How Tabb suggestions work.</h2>
                <p className="lede">
                  Tabb watches recent typing context in memory, requests a continuation, and shows a floating overlay near the
                  bottom of the active display.
                </p>
              </div>
              <div className="tutorial-grid">
                <div className="tutorial-panel">
                  <strong>Accept</strong>
                  <span>Press Option+Tab or click the suggestion to paste it into the app you were using.</span>
                </div>
                <div className="tutorial-panel">
                  <strong>Dismiss</strong>
                  <span>Ignore it, press Escape when available, or keep typing so the suggestion becomes stale.</span>
                </div>
                <div className="tutorial-panel">
                  <strong>Stay focused</strong>
                  <span>The real suggestion overlay remains separate from this onboarding window.</span>
                </div>
              </div>
            </>
          ) : null}

          {step === "practice" ? (
            <>
              <div className="onboarding-hero">
                <h2>Practice with a mock suggestion.</h2>
                <p className="lede">This sandbox does not call the API or paste into another app.</p>
              </div>
              <textarea
                className="practice-input"
                onChange={(event) => setPracticeText(event.target.value)}
                rows={4}
                value={practiceText}
              />
              {suggestionVisible ? (
                <div className="practice-suggestion">
                  <div>
                    <span>Suggested completion</span>
                    <strong>{MOCK_SUGGESTIONS[suggestionIndex]}</strong>
                  </div>
                  <div className="practice-suggestion__actions">
                    <Button onClick={approveSuggestion}>Approve</Button>
                    <Button onClick={rejectSuggestion} variant="secondary">
                      Reject
                    </Button>
                  </div>
                </div>
              ) : (
                <Button onClick={tryAgain} variant="secondary">
                  Try another suggestion
                </Button>
              )}
              <div className="practice-checks">
                <StatusBadge tone={approvedPractice ? "ok" : "muted"}>Approve practiced</StatusBadge>
                <StatusBadge tone={rejectedPractice ? "ok" : "muted"}>Reject practiced</StatusBadge>
              </div>
            </>
          ) : null}

          {step === "done" ? (
            <>
              <div className="onboarding-hero">
                <h2>Tabb is ready.</h2>
                <p className="lede">
                  Finish setup to open the Tabb app. You can revisit account, permissions, pause, and memory controls in Settings.
                </p>
              </div>
              <div className="privacy-card">
                <strong>Running in the background</strong>
                <span>Tabb keeps the overlay hidden until there is a suggestion to show.</span>
              </div>
            </>
          ) : null}
        </section>

        {statusMessage ? <div className="onboarding-status no-drag">{statusMessage}</div> : null}

        {step === "permissions" ? (
          <details className="dev-note no-drag">
            <summary>Development mode note</summary>
            <p>
              macOS permission entries are tied to the exact app bundle. If Tabb is not listed while running from source,
              use <code>bun run desktop:permissions</code> and enable the packaged Tabb app.
            </p>
          </details>
        ) : null}

        <footer className="onboarding-actions no-drag">
          {step !== "sign-in" ? (
            <Button disabled={busy || currentStepIndex === 0} onClick={goBack} variant="secondary">
              Back
            </Button>
          ) : null}
          <Button className={step === "sign-in" ? "col-span-full" : undefined} disabled={busy} onClick={handlePrimaryAction}>
            {primaryLabel}
          </Button>
          {step === "permissions" ? (
            <Button disabled={busy} onClick={() => refreshAccessibilityStatus().catch(() => {})} variant="secondary">
              Refresh Permission Status
            </Button>
          ) : null}
          {step === "permissions" && inputMonitoringOpened ? (
            <Button disabled={busy} onClick={() => window.tabb?.relaunchForPermissions?.()} variant="ghost">
              Relaunch Tabb
            </Button>
          ) : null}
          {step === "practice" && !practiceComplete ? (
            <Button disabled={busy} onClick={goNext} variant="ghost">
              Finish anyway
            </Button>
          ) : null}
        </footer>
      </SectionCard>
    </main>
  );
}
