import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../components/Button";
import { PermissionCard } from "../components/PermissionCard";

type OnboardingStep = "accessibility" | "input-monitoring" | "done";

export function OnboardingSurface() {
  const [step, setStep] = useState<OnboardingStep>("accessibility");
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);
  const [inputMonitoringOpened, setInputMonitoringOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

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
        setStep((currentStep) => (currentStep === "accessibility" ? "input-monitoring" : currentStep));
        setStatusMessage(
          "Accessibility is enabled. Next, add Tabb to Input Monitoring so it can observe typing context and Option+Tab.",
        );
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
    refreshAccessibilityStatus().catch(() => {
      setAccessibilityGranted(false);
    });

    return stopAccessibilityPolling;
  }, [refreshAccessibilityStatus, stopAccessibilityPolling]);

  async function handlePrimaryAction() {
    if (!window.tabb) return;

    if (step === "accessibility") {
      setBusy(true);
      try {
        const alreadyGranted = Boolean(await window.tabb.openAccessibilitySettings?.());
        setAccessibilityState(alreadyGranted);
        if (!alreadyGranted) {
          setStatusMessage(
            "System Settings opened to Accessibility. Turn on Tabb; this window will continue automatically once macOS reports it is enabled.",
          );
          startAccessibilityPolling();
        }
      } finally {
        setBusy(false);
      }
      return;
    }

    if (step === "input-monitoring") {
      setBusy(true);
      try {
        await window.tabb.openInputMonitoringSettings?.();
        await window.tabb.revealAppInFinder?.();
        setInputMonitoringOpened(true);
        setStep("done");
        setStatusMessage(
          "System Settings opened to Input Monitoring. If Tabb is not listed in dev mode, run `bun run desktop:permissions` and enable the packaged Tabb app. After enabling, use Relaunch Tabb if macOS does not reopen it.",
        );
      } finally {
        setBusy(false);
      }
      return;
    }

    if (accessibilityGranted && inputMonitoringOpened && window.tabb.completeOnboarding) {
      window.tabb.completeOnboarding();
    } else {
      setStatusMessage("Finish both permission steps before continuing.");
    }
  }

  async function handleRefresh() {
    setBusy(true);
    try {
      await refreshAccessibilityStatus();
    } catch {
      setStatusMessage("Tabb could not read the current Accessibility status. Try again after System Settings opens.");
    } finally {
      setBusy(false);
    }
  }

  const primaryLabel =
    step === "accessibility"
      ? "Open Accessibility Settings"
      : step === "input-monitoring"
        ? "Open Input Monitoring Settings"
        : "I've Enabled Both Permissions";

  return (
    <main className="onboarding-shell">
      <section className="onboarding-card section-card">
        <div className="onboarding-card__chrome drag-region" aria-hidden="true" />
        <header className="onboarding-hero drag-region">
          <p className="eyebrow">Welcome to Tabb</p>
          <h1>Two permissions, one private typing assistant.</h1>
          <p className="lede">
            Tabb observes recent typing context in memory so it can suggest completions in other macOS apps. It does not
            request Screen Recording or Full Disk Access.
          </p>
        </header>

        <div className="onboarding-progress" aria-label="Setup progress">
          <span data-active={step === "accessibility" || accessibilityGranted} />
          <span data-active={step === "input-monitoring" || step === "done"} />
          <span data-active={step === "done" && inputMonitoringOpened} />
        </div>

        <div className="onboarding-permissions">
          <PermissionCard
            title="Accessibility"
            description="Lets Tabb paste accepted suggestions into the previously active application and guide setup."
            status={accessibilityGranted ? "Enabled" : "Needs access"}
            state={accessibilityGranted ? "granted" : "pending"}
          />
          <PermissionCard
            title="Input Monitoring"
            description="Lets Tabb listen for text-bearing typing context and the Option+Tab acceptance shortcut."
            status={inputMonitoringOpened ? "Confirm in System Settings" : "Relaunch may be required"}
            state={inputMonitoringOpened ? "pending" : "manual"}
          />
        </div>

        <div className="privacy-card">
          <strong>Privacy scope</strong>
          <span>Your recent typing context stays in memory only. It is not stored as a raw log or used to build hidden profiles.</span>
        </div>

        {statusMessage ? <div className="onboarding-status">{statusMessage}</div> : null}

        <details className="dev-note">
          <summary>Development mode note</summary>
          <p>
            macOS permission entries are tied to the exact app bundle. If Tabb is not listed while running from source,
            use <code>bun run desktop:permissions</code> and enable the packaged Tabb app.
          </p>
        </details>

        <footer className="onboarding-actions no-drag">
          <Button disabled={busy || (step === "accessibility" && accessibilityGranted)} onClick={handlePrimaryAction}>
            {primaryLabel}
          </Button>
          <Button disabled={busy} onClick={handleRefresh} variant="secondary">
            Refresh Permission Status
          </Button>
          {step === "done" ? (
            <Button disabled={busy} onClick={() => window.tabb?.relaunchForPermissions?.()} variant="ghost">
              Relaunch Tabb
            </Button>
          ) : null}
        </footer>
      </section>
    </main>
  );
}
