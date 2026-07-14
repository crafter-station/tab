import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Eyebrow, SuggestionCommand, TabMark, Textarea } from "@tab/ui";
import { APP_CONTEXT_TRUST_COPY } from "../../../main/app-context";
import { ONBOARDING_STEP_COPY, ONBOARDING_STEPS, type OnboardingStep } from "../../../main/onboarding";

type Feedback = {
  message: string;
  tone: "info" | "success" | "warning";
};

type PermissionState = "complete" | "current" | "upcoming";

const INITIAL_DRAFT = "Hi Jordan, quick update on the launch plan:";
const SAMPLE_SUGGESTIONS = [
  "I can review the final details this afternoon and send next steps.",
  "Everything is on track for Friday. I will share the final checklist shortly.",
  "The team has what it needs, and I will follow up after the last review.",
];

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 16 16">
      <path d="m3.25 8.25 3 3 6.5-6.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 16 16">
      <rect height="7.5" rx="2" stroke="currentColor" strokeWidth="1.4" width="10.5" x="2.75" y="6.5" />
      <path d="M5.25 6.5V4.75a2.75 2.75 0 0 1 5.5 0V6.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
    </svg>
  );
}

function PermissionRow({
  description,
  index,
  note,
  state,
  status,
  title,
}: {
  description: string;
  index: number;
  note?: string;
  state: PermissionState;
  status: string;
  title: string;
}) {
  return (
    <article className="permission-row" data-state={state}>
      <div className="permission-row__marker" aria-hidden="true">
        {state === "complete" ? <CheckIcon /> : index}
      </div>
      <div className="permission-row__content">
        <div className="permission-row__title">
          <h2>{title}</h2>
          <span>{status}</span>
        </div>
        <p>{description}</p>
        {note ? <p className="permission-row__note">{note}</p> : null}
      </div>
    </article>
  );
}

export function OnboardingSurface() {
  const [step, setStep] = useState<OnboardingStep>("try");
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);
  const [inputMonitoringOpened, setInputMonitoringOpened] = useState(false);
  const [inputMonitoringConfirmed, setInputMonitoringConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [practiceText, setPracticeText] = useState(INITIAL_DRAFT);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [acceptedPractice, setAcceptedPractice] = useState(false);
  const pollRef = useRef<number | null>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const initialStepRef = useRef(true);

  const currentStepIndex = ONBOARDING_STEPS.indexOf(step);

  const stopAccessibilityPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const refreshAccessibilityStatus = useCallback(async () => {
    if (!window.tab?.checkAccessibilityPermission) {
      setAccessibilityGranted(false);
      return false;
    }

    const granted = Boolean(await window.tab.checkAccessibilityPermission());
    if (granted && !accessibilityGranted && step === "permissions") {
      setFeedback({
        message: "Accessibility is enabled. Next, open Input Monitoring.",
        tone: "success",
      });
    }
    setAccessibilityGranted(granted);
    if (granted) stopAccessibilityPolling();
    return granted;
  }, [accessibilityGranted, step, stopAccessibilityPolling]);

  const startAccessibilityPolling = useCallback(() => {
    stopAccessibilityPolling();
    pollRef.current = window.setInterval(() => {
      refreshAccessibilityStatus().catch(() => {});
    }, 1200);
  }, [refreshAccessibilityStatus, stopAccessibilityPolling]);

  useEffect(() => {
    refreshAccessibilityStatus().catch(() => setAccessibilityGranted(false));
    return stopAccessibilityPolling;
  }, [refreshAccessibilityStatus, stopAccessibilityPolling]);

  useEffect(() => {
    if (initialStepRef.current) {
      initialStepRef.current = false;
      return;
    }

    const frame = window.requestAnimationFrame(() => stepHeadingRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [step]);

  async function openAccessibility() {
    setBusy(true);
    setFeedback(null);
    try {
      const alreadyGranted = Boolean(await window.tab?.openAccessibilitySettings?.());
      setAccessibilityGranted(alreadyGranted);
      if (alreadyGranted) {
        setFeedback({ message: "Accessibility is already enabled.", tone: "success" });
      } else {
        setFeedback({
          message: "Turn on Tab in Accessibility. This window will update automatically.",
          tone: "info",
        });
        startAccessibilityPolling();
      }
    } catch {
      setFeedback({
        message: "System Settings did not open. Open Privacy & Security, then Accessibility, and turn on Tab.",
        tone: "warning",
      });
    } finally {
      setBusy(false);
    }
  }

  async function openInputMonitoring() {
    setBusy(true);
    setFeedback(null);
    try {
      await window.tab?.openInputMonitoringSettings?.();
      await window.tab?.revealAppInFinder?.();
      setInputMonitoringOpened(true);
      setFeedback({
        message: "Turn on Tab in Input Monitoring, then return here and confirm below.",
        tone: "info",
      });
    } catch {
      setFeedback({
        message: "System Settings did not open. Open Privacy & Security, then Input Monitoring, and turn on Tab.",
        tone: "warning",
      });
    } finally {
      setBusy(false);
    }
  }

  function goNext() {
    const nextStep = ONBOARDING_STEPS[currentStepIndex + 1];
    if (nextStep) {
      setFeedback(null);
      setStep(nextStep);
    }
  }

  function goBack() {
    const previousStep = ONBOARDING_STEPS[currentStepIndex - 1];
    if (previousStep) {
      setFeedback(null);
      setStep(previousStep);
    }
  }

  function acceptPracticeSuggestion() {
    if (acceptedPractice) return;
    setPracticeText((value) => `${value.trimEnd()} ${SAMPLE_SUGGESTIONS[suggestionIndex]}`);
    setAcceptedPractice(true);
  }

  function resetPractice() {
    setSuggestionIndex((index) => (index + 1) % SAMPLE_SUGGESTIONS.length);
    setPracticeText(INITIAL_DRAFT);
    setAcceptedPractice(false);
    setFeedback(null);
  }

  async function handlePrimaryAction() {
    switch (step) {
      case "try":
        if (!acceptedPractice) {
          acceptPracticeSuggestion();
          return;
        }
        goNext();
        return;

      case "permissions":
        if (!accessibilityGranted) {
          await openAccessibility();
          return;
        }
        if (!inputMonitoringOpened) {
          await openInputMonitoring();
          return;
        }
        if (!inputMonitoringConfirmed) {
          setInputMonitoringConfirmed(true);
        }
        goNext();
        return;

      case "done":
        window.tab?.completeOnboardingAndRelaunch?.();
    }
  }

  function getPrimaryLabel() {
    if (busy) return "Opening System Settings...";
    if (step === "try") return acceptedPractice ? "Continue" : "Accept sample Suggestion";
    if (step === "done") return "Relaunch Tab";
    if (!accessibilityGranted) return "Open Accessibility Settings";
    if (!inputMonitoringOpened) return "Open Input Monitoring";
    if (!inputMonitoringConfirmed) return "I turned it on";
    return "Continue";
  }

  return (
    <main className="onboarding-shell" aria-busy={busy}>
      <aside className="onboarding-sidebar drag-region">
        <div className="onboarding-sidebar__chrome" aria-hidden="true" />
        <div className="onboarding-brand">
          <TabMark />
          <div>
            <strong>Tab</strong>
            <span>Setup for this Mac</span>
          </div>
        </div>

        <nav className="onboarding-progress" aria-label="Setup progress">
          <ol>
            {ONBOARDING_STEPS.map((item, index) => {
              const itemState = index < currentStepIndex ? "complete" : index === currentStepIndex ? "current" : "upcoming";
              return (
                <li aria-current={item === step ? "step" : undefined} data-state={itemState} key={item}>
                  <span className="onboarding-progress__marker" aria-hidden="true">
                    {itemState === "complete" ? <CheckIcon /> : index + 1}
                  </span>
                  <span className="onboarding-progress__copy">
                    <strong>{ONBOARDING_STEP_COPY[item].title}</strong>
                    <small>{ONBOARDING_STEP_COPY[item].subtitle}</small>
                  </span>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="onboarding-sidebar__footer no-drag">
          {step === "permissions" ? null : (
            <div className="onboarding-trust-note">
              <LockIcon />
              <div>
                <strong>No Screen Recording or Full Disk Access</strong>
                <span>Automatic Suggestions use recent typing on this Mac.</span>
              </div>
            </div>
          )}
          <Button className="onboarding-later" onClick={() => window.tab?.skipOnboarding?.()} variant="ghost">
            Not now
          </Button>
          <span className="onboarding-later__hint">Permissions remain available in Settings.</span>
        </div>
      </aside>

      <section className="onboarding-main">
        <div className="onboarding-main__drag drag-region" aria-hidden="true" />
        <div className="onboarding-content no-drag">
          <p className="onboarding-step-count">
            Step {currentStepIndex + 1} of {ONBOARDING_STEPS.length}
          </p>

          <section className="onboarding-step" key={step} aria-labelledby="onboarding-step-title">
            {step === "try" ? (
              <>
                <header className="onboarding-hero">
                  <Eyebrow>Practice</Eyebrow>
                  <h1 id="onboarding-step-title" ref={stepHeadingRef} tabIndex={-1}>
                    Try accepting a Suggestion.
                  </h1>
                  <p className="lede">
                    Tab suggests a short continuation. It is added only when you accept it.
                  </p>
                </header>

                <div className="practice-demo">
                  <div className="practice-demo__header">
                    <span>Sample Suggestion</span>
                  </div>
                  <div className="practice-demo__body">
                    <label htmlFor="practice-draft">Your draft</label>
                    <Textarea
                      className="practice-input"
                      id="practice-draft"
                      onChange={(event) => {
                        setPracticeText(event.target.value);
                        if (acceptedPractice) setAcceptedPractice(false);
                      }}
                      rows={4}
                      value={practiceText}
                    />

                    {acceptedPractice ? (
                      <div className="practice-result">
                        <div className="practice-result__icon">
                          <CheckIcon />
                        </div>
                        <div>
                          <strong>Suggestion accepted</strong>
                          <span>Tab added it to your draft.</span>
                        </div>
                        <Button onClick={resetPractice} size="sm" variant="ghost">
                          Try another
                        </Button>
                      </div>
                    ) : (
                      <SuggestionCommand
                        aria-label={`Accept sample suggestion: ${SAMPLE_SUGGESTIONS[suggestionIndex]}`}
                        onClick={acceptPracticeSuggestion}
                        suggestion={SAMPLE_SUGGESTIONS[suggestionIndex]}
                      />
                    )}

                    <p className="practice-demo__hint">
                      Select the Suggestion here. In other apps, press Option+Tab. Keep typing to dismiss it.
                    </p>
                  </div>
                </div>
              </>
            ) : null}

            {step === "permissions" ? (
              <>
                <header className="onboarding-hero">
                  <Eyebrow>macOS permissions</Eyebrow>
                  <h1 id="onboarding-step-title" ref={stepHeadingRef} tabIndex={-1}>
                    Allow Tab to work in your apps.
                  </h1>
                  <p className="lede">
                     Turn on these permissions in order. Tab uses them to read the active text field and insert only Suggestions you accept.
                  </p>
                </header>

                <div className="permission-list">
                  <PermissionRow
                    description="Lets Tab read the active text field and insert a Suggestion you accept."
                    index={1}
                    note={
                      accessibilityGranted
                        ? undefined
                        : "Turn on Tab in the Accessibility list. This window checks the result automatically."
                    }
                    state={accessibilityGranted ? "complete" : "current"}
                    status={accessibilityGranted ? "Enabled" : "Not enabled"}
                    title="Accessibility"
                  />
                  <PermissionRow
                    description="Lets Tab notice typing and recognize the Option+Tab shortcut."
                    index={2}
                    note={
                      inputMonitoringOpened
                        ? "Turn on Tab in System Settings, then return here and confirm with the button below."
                        : accessibilityGranted
                          ? "System Settings and Finder will open so you can locate Tab if macOS does not list it."
                          : undefined
                    }
                    state={inputMonitoringConfirmed ? "complete" : accessibilityGranted ? "current" : "upcoming"}
                    status={
                      inputMonitoringConfirmed
                        ? "Confirmed"
                        : inputMonitoringOpened
                          ? "Finish in Settings"
                          : accessibilityGranted
                            ? "Next"
                            : "Waiting"
                    }
                    title="Input Monitoring"
                  />
                </div>

                <details className="onboarding-privacy">
                  <summary>
                    <LockIcon />
                    <span>
                      <strong>No Screen Recording or Full Disk Access</strong>
                      <small>Review exactly what Tab can use.</small>
                    </span>
                    <span className="onboarding-privacy__chevron" aria-hidden="true" />
                  </summary>
                  <div className="onboarding-privacy__panel">
                    <p>
                      Recent typing is used to make suggestions. Saved memories remain visible and controlled by you.
                    </p>
                    <p>{APP_CONTEXT_TRUST_COPY.summary}</p>
                  </div>
                </details>

                {import.meta.env.DEV ? (
                  <details className="dev-note">
                    <summary>Running from source?</summary>
                    <p>
                      macOS permissions belong to the exact app bundle. If Tab is not listed, run <code>bun run desktop:permissions</code> and enable the packaged app.
                    </p>
                  </details>
                ) : null}
              </>
            ) : null}

            {step === "done" ? (
              <div className="onboarding-ready">
                <div className="onboarding-ready__mark" aria-hidden="true">
                  <CheckIcon />
                </div>
                <header className="onboarding-hero">
                   <Eyebrow>One last step</Eyebrow>
                   <h1 id="onboarding-step-title" ref={stepHeadingRef} tabIndex={-1}>
                     Relaunch to finish setup.
                   </h1>
                   <p className="lede">
                     Tab needs one relaunch after Input Monitoring changes.
                  </p>
                </header>

                <div className="ready-list">
                  <div>
                    <span>01</span>
                    <p>
                      <strong>Type naturally</strong>
                      <small>Tab shows a Suggestion when it has a continuation to offer.</small>
                    </p>
                  </div>
                  <div>
                    <span>02</span>
                    <p>
                      <strong>Accept with Option+Tab</strong>
                      <small>Tab inserts the Suggestion in the app you are using.</small>
                    </p>
                  </div>
                  <div>
                    <span>03</span>
                    <p>
                      <strong>Double-tap Option for Deep Complete</strong>
                      <small>Tab sends a limited, redacted excerpt to the cloud only when you ask.</small>
                    </p>
                  </div>
                  <div>
                    <span>04</span>
                    <p>
                      <strong>Stay in control</strong>
                      <small>Pause suggestions or review memories anytime in Settings.</small>
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          <div className="onboarding-feedback" data-tone={feedback?.tone ?? "info"} data-visible={Boolean(feedback)} role="status" aria-live="polite">
            {feedback ? <span>{feedback.message}</span> : null}
          </div>
        </div>

        {step === "try" && !acceptedPractice ? null : (
          <footer className="onboarding-actions no-drag">
            <div>
              {currentStepIndex > 0 ? (
                <Button disabled={busy} onClick={goBack} variant="secondary">
                  Back
                </Button>
              ) : null}
            </div>
            <Button className="onboarding-primary" disabled={busy} onClick={handlePrimaryAction} size="lg">
              {getPrimaryLabel()}
            </Button>
          </footer>
        )}
      </section>
    </main>
  );
}
