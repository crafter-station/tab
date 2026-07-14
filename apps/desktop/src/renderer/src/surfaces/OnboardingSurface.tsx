import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Eyebrow, SuggestionCommand, TabMark, Textarea } from "@tab/ui";
import { APP_CONTEXT_TRUST_COPY } from "../../../main/app-context";
import type { LocalInferenceStatus } from "@tab/contracts";
import { ONBOARDING_STEP_COPY, ONBOARDING_STEPS, type OnboardingStep } from "../../../main/onboarding";

type Feedback = {
  message: string;
  tone: "info" | "success" | "warning";
};

type PermissionState = "complete" | "current" | "upcoming";
type DeepPracticeState = "idle" | "armed" | "suggestion" | "accepted";

const INITIAL_DRAFT = "Hi Jordan, quick update on the launch plan:";
const SAMPLE_SUGGESTION = "Everything is on track for Friday. I will share the final checklist shortly.";
const DEEP_DRAFT = "We delayed the launch after the final security review because";
const DEEP_SUGGESTION = "the remaining issues could affect customer data, and protecting that trust matters more than shipping this week.";
const DOUBLE_OPTION_WINDOW_MS = 400;

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
  const [step, setStep] = useState<OnboardingStep>("model");
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);
  const [inputMonitoringOpened, setInputMonitoringOpened] = useState(false);
  const [inputMonitoringConfirmed, setInputMonitoringConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [practiceText, setPracticeText] = useState(INITIAL_DRAFT);
  const [acceptedPractice, setAcceptedPractice] = useState(false);
  const [deepPracticeText, setDeepPracticeText] = useState(DEEP_DRAFT);
  const [deepPracticeState, setDeepPracticeState] = useState<DeepPracticeState>("idle");
  const [localInferenceStatus, setLocalInferenceStatus] = useState<LocalInferenceStatus>({ status: "stopped" });
  const acceptedPracticeRef = useRef(false);
  const deepPracticeStateRef = useRef<DeepPracticeState>("idle");
  const lastOptionReleaseRef = useRef<number | null>(null);
  const optionResetTimerRef = useRef<number | null>(null);
  const pollRef = useRef<number | null>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const initialStepRef = useRef(true);

  const currentStepIndex = ONBOARDING_STEPS.indexOf(step);
  const modelNeedsDownload = localInferenceStatus.status === "unavailable"
    && ["missing_model", "artifact_mismatch", "download_failed"].includes(localInferenceStatus.reason);
  const modelIsPreparing = localInferenceStatus.status === "stopped"
    || localInferenceStatus.status === "starting"
    || localInferenceStatus.status === "downloading";

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
    if (!window.tab) return;
    let receivedStatus = false;
    const unsubscribe = window.tab.onLocalInferenceStatusChanged((status) => {
      receivedStatus = true;
      setLocalInferenceStatus(status);
    });
    window.tab.getInitialState().then((initialState) => {
      if (!receivedStatus) setLocalInferenceStatus(initialState.localInferenceStatus);
    }).catch(() => {});
    return unsubscribe;
  }, []);

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

  const acceptPracticeSuggestion = useCallback(() => {
    if (acceptedPracticeRef.current) return;
    acceptedPracticeRef.current = true;
    setPracticeText((value) => `${value.trimEnd()} ${SAMPLE_SUGGESTION}`);
    setAcceptedPractice(true);
  }, []);

  const setDeepState = useCallback((state: DeepPracticeState) => {
    deepPracticeStateRef.current = state;
    setDeepPracticeState(state);
  }, []);

  const requestDeepPracticeSuggestion = useCallback(() => {
    lastOptionReleaseRef.current = null;
    if (optionResetTimerRef.current !== null) window.clearTimeout(optionResetTimerRef.current);
    optionResetTimerRef.current = null;
    setDeepState("suggestion");
  }, [setDeepState]);

  const acceptDeepPracticeSuggestion = useCallback(() => {
    if (deepPracticeStateRef.current !== "suggestion") return;
    setDeepPracticeText((value) => `${value.trimEnd()} ${DEEP_SUGGESTION}`);
    setDeepState("accepted");
  }, [setDeepState]);

  useEffect(() => window.tab?.onOnboardingOptionTab?.(() => {
    if (step === "try") acceptPracticeSuggestion();
    if (step === "deep") acceptDeepPracticeSuggestion();
  }), [acceptDeepPracticeSuggestion, acceptPracticeSuggestion, step]);

  useEffect(() => {
    if (step !== "deep") return;

    function handleKeyDown(event: KeyboardEvent) {
      if (deepPracticeStateRef.current === "suggestion" || deepPracticeStateRef.current === "accepted") return;
      if (event.key !== "Alt") {
        lastOptionReleaseRef.current = null;
        setDeepState("idle");
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (deepPracticeStateRef.current === "suggestion" || deepPracticeStateRef.current === "accepted") return;
      if (event.key !== "Alt" || event.repeat) return;
      const now = performance.now();
      const previousRelease = lastOptionReleaseRef.current;
      if (previousRelease !== null && now - previousRelease <= DOUBLE_OPTION_WINDOW_MS) {
        requestDeepPracticeSuggestion();
        return;
      }

      lastOptionReleaseRef.current = now;
      setDeepState("armed");
      if (optionResetTimerRef.current !== null) window.clearTimeout(optionResetTimerRef.current);
      optionResetTimerRef.current = window.setTimeout(() => {
        lastOptionReleaseRef.current = null;
        optionResetTimerRef.current = null;
        setDeepState("idle");
      }, DOUBLE_OPTION_WINDOW_MS);
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      if (optionResetTimerRef.current !== null) window.clearTimeout(optionResetTimerRef.current);
      optionResetTimerRef.current = null;
      lastOptionReleaseRef.current = null;
    };
  }, [requestDeepPracticeSuggestion, setDeepState, step]);

  async function downloadLocalModel() {
    setBusy(true);
    setFeedback(null);
    try {
      await window.tab.downloadLocalModel();
    } catch {
      setFeedback({
        message: "The model could not be downloaded. Check your connection and try again.",
        tone: "warning",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handlePrimaryAction() {
    switch (step) {
      case "model":
        if (modelNeedsDownload) {
          await downloadLocalModel();
          return;
        }
        if (!modelIsPreparing) goNext();
        return;

      case "try":
        if (!acceptedPractice) {
          acceptPracticeSuggestion();
          return;
        }
        goNext();
        return;

      case "deep":
        if (deepPracticeState === "accepted") goNext();
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
    if (busy && step === "model") return "Downloading...";
    if (busy) return "Opening System Settings...";
    if (step === "model") {
      if (modelNeedsDownload) return "Download local model";
      if (localInferenceStatus.status === "downloading") {
        return localInferenceStatus.progress === null
          ? "Downloading..."
          : `Downloading ${Math.round(localInferenceStatus.progress * 100)}%`;
      }
      if (localInferenceStatus.status === "ready") return "Continue";
      if (localInferenceStatus.status === "unavailable") return "Continue without local Suggestions";
      return "Preparing model...";
    }
    if (step === "try") return acceptedPractice ? "Continue" : "Accept sample Suggestion";
    if (step === "deep") return deepPracticeState === "accepted" ? "Continue" : "Complete the shortcut above";
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
          <Button className="onboarding-later" onClick={() => window.tab?.skipOnboarding?.()} size="sm" variant="ghost">
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
            {step === "model" ? (
              <>
                <header className="onboarding-hero">
                  <Eyebrow>Private by default</Eyebrow>
                  <h1 id="onboarding-step-title" ref={stepHeadingRef} tabIndex={-1}>
                    Bring Automatic Suggestions to this Mac.
                  </h1>
                  <p className="lede">
                    Tab uses a one-time local model download for everyday completions. Your recent typing stays on this Mac.
                  </p>
                </header>

                <div className="model-setup" data-status={localInferenceStatus.status}>
                  <div className="model-setup__status">
                    <span className="model-setup__dot" aria-hidden="true" />
                    <div>
                      <strong>
                        {localInferenceStatus.status === "ready"
                          ? "Local model ready"
                          : localInferenceStatus.status === "downloading"
                            ? "Downloading local model"
                            : modelNeedsDownload
                              ? "Local model required"
                              : localInferenceStatus.status === "unavailable"
                                ? "Local Suggestions unavailable"
                                : "Checking this Mac"}
                      </strong>
                      <span>
                        {localInferenceStatus.status === "ready"
                          ? "Automatic Suggestions can run entirely on this Mac."
                          : localInferenceStatus.status === "downloading"
                            ? "Keep Tab open. You can see exact progress below."
                            : modelNeedsDownload
                              ? "A roughly 2 GB download. Tab verifies it before use."
                              : localInferenceStatus.status === "unavailable"
                                ? "You can finish setup and troubleshoot the local runtime in Settings."
                                : "Tab is checking for the model and local runtime."}
                      </span>
                    </div>
                  </div>
                  {localInferenceStatus.status === "downloading" ? (
                    <div
                      aria-label="Local model download progress"
                      aria-valuemax={100}
                      aria-valuemin={0}
                      aria-valuenow={localInferenceStatus.progress === null ? undefined : Math.round(localInferenceStatus.progress * 100)}
                      className="model-setup__progress"
                      role="progressbar"
                    >
                      <span style={{ transform: `scaleX(${localInferenceStatus.progress ?? 0.04})` }} />
                    </div>
                  ) : null}
                  <div className="model-setup__facts">
                    <span><CheckIcon /> Routine Suggestions stay local</span>
                    <span><CheckIcon /> No automatic cloud fallback</span>
                  </div>
                </div>
              </>
            ) : null}

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
                    <span>Shortcut rehearsal</span>
                  </div>
                  <div className="practice-demo__body">
                    <label htmlFor="practice-draft">Your draft</label>
                    <Textarea
                      className="practice-input"
                      id="practice-draft"
                      onChange={(event) => {
                        setPracticeText(event.target.value);
                        if (acceptedPractice) {
                          acceptedPracticeRef.current = false;
                          setAcceptedPractice(false);
                        }
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
                      </div>
                    ) : (
                      <SuggestionCommand
                        aria-label={`Accept sample suggestion: ${SAMPLE_SUGGESTION}`}
                        onClick={acceptPracticeSuggestion}
                        suggestion={SAMPLE_SUGGESTION}
                      />
                    )}

                    <p className="practice-demo__hint">
                      Press Option+Tab now. This rehearsal stays inside setup; real Suggestions appear at the bottom of your screen after relaunch.
                    </p>
                  </div>
                </div>
              </>
            ) : null}

            {step === "deep" ? (
              <>
                <header className="onboarding-hero">
                  <Eyebrow>More context, when you ask</Eyebrow>
                  <h1 id="onboarding-step-title" ref={stepHeadingRef} tabIndex={-1}>
                    Ask for a Deep Complete Suggestion.
                  </h1>
                  <p className="lede">
                    Double-tap Option when a thought needs more context. Then accept the Suggestion with the same Option+Tab shortcut.
                  </p>
                </header>

                <div className="practice-demo deep-practice">
                  <div className="practice-demo__header">
                    <span>Deep Complete rehearsal</span>
                    <small>Cloud, only when requested</small>
                  </div>
                  <div className="practice-demo__body">
                    <label htmlFor="deep-practice-draft">Your draft</label>
                    <Textarea
                      className="practice-input"
                      id="deep-practice-draft"
                      onChange={(event) => {
                        setDeepPracticeText(event.target.value);
                        if (deepPracticeState !== "idle") setDeepState("idle");
                      }}
                      rows={4}
                      value={deepPracticeText}
                    />

                    {deepPracticeState === "accepted" ? (
                      <div className="practice-result">
                        <div className="practice-result__icon">
                          <CheckIcon />
                        </div>
                        <div>
                          <strong>Deep Complete accepted</strong>
                          <span>You requested more context, then chose to add it.</span>
                        </div>
                      </div>
                    ) : deepPracticeState === "suggestion" ? (
                      <SuggestionCommand
                        aria-label={`Accept Deep Complete suggestion: ${DEEP_SUGGESTION}`}
                        onClick={acceptDeepPracticeSuggestion}
                        source="cloud"
                        suggestion={DEEP_SUGGESTION}
                      />
                    ) : (
                      <div className="deep-practice__trigger" data-armed={deepPracticeState === "armed" || undefined}>
                        <div className="deep-practice__keys" aria-hidden="true">
                          <kbd>⌥</kbd>
                          <kbd>⌥</kbd>
                        </div>
                        <div>
                          <strong>{deepPracticeState === "armed" ? "Option once. Press it again." : "Double-tap Option"}</strong>
                          <span>Request a higher-capability Suggestion for this draft.</span>
                        </div>
                        <Button onClick={requestDeepPracticeSuggestion} size="sm" variant="ghost">
                          Show sample
                        </Button>
                      </div>
                    )}

                    <p className="practice-demo__hint" aria-live="polite">
                      {deepPracticeState === "suggestion"
                        ? "Now press Option+Tab to accept the Deep Complete Suggestion."
                        : deepPracticeState === "accepted"
                          ? "That is the full Deep Complete flow: request, review, then accept."
                          : "This rehearsal does not send anything. In other apps, the gesture sends bounded, redacted context only when you request it."}
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
                  <div className="ready-list__secondary">
                    <span>03</span>
                    <p>
                      <strong>Need more help? Double-tap Option.</strong>
                      <small>Deep Complete uses bounded, redacted cloud context only when you ask. Accept its Suggestion with the same Option+Tab shortcut.</small>
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

        {(step === "try" && !acceptedPractice) || (step === "deep" && deepPracticeState !== "accepted") ? null : (
          <footer className="onboarding-actions no-drag">
            <div>
              {currentStepIndex > 0 ? (
                <Button disabled={busy} onClick={goBack} variant="secondary">
                  Back
                </Button>
              ) : null}
            </div>
            <Button className="onboarding-primary" disabled={busy || (step === "model" && modelIsPreparing)} onClick={handlePrimaryAction} size="lg">
              {getPrimaryLabel()}
            </Button>
          </footer>
        )}
      </section>
    </main>
  );
}
