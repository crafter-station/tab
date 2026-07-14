import { useCallback, useEffect, useState } from "react";
import {
  Button,
  CommandBlock,
  EmptyState,
  SettingsGroup,
  SettingsRow,
  StatusBadge,
  StatusRow,
  SummaryMetric,
  Switch,
  TabMark,
  Textarea,
  THEME_MODES,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  ToggleGroupItem,
  getStoredThemePreference,
  setThemePreference,
  type ThemeMode,
} from "@tab/ui";
import type { PersonalMemory } from "@tab/contracts";
import type { DesktopStatus } from "../../../main/status";
import type { LocalInferenceStatus } from "../../../main/local-inference-prototype";
import type { CompletionHistoryEntry } from "../../../main/completion-history";
import type { DesktopUpdateState } from "../../../main/release";
import { APP_CONTEXT_SUPPORTED_APP_MATRIX, APP_CONTEXT_TRUST_COPY } from "../../../main/app-context";
import { describePauseState, describePersonalMemorySource } from "./settingsCopy";

type InitialState = Awaited<ReturnType<NonNullable<typeof window.tab>["getInitialState"]>>;
type SettingsTab = "account" | "completions" | "controls" | "appearance" | "permissions" | "memory" | "updates";

const SETTINGS_TABS: { value: SettingsTab; label: string; description: string }[] = [
  { value: "account", label: "Account", description: "Plan, usage, and connection status." },
  { value: "completions", label: "Suggestion history", description: "Suggestions from this session." },
  { value: "controls", label: "Suggestions", description: "Control when Tab suggests and how it writes." },
  { value: "appearance", label: "Appearance", description: "Choose how Tab looks on this Mac." },
  { value: "permissions", label: "Permissions", description: "Review the macOS access Tab needs." },
  { value: "memory", label: "Personal Memory", description: "Control saved details used in Suggestions." },
  { value: "updates", label: "Updates", description: "Keep Tab secure and up to date." },
];

function getAuthStatusRowTone(auth: DesktopStatus["auth"]) {
  if (auth === "signed_in") return "success";
  if (auth === "revoked_device") return "warning";
  return "neutral";
}

function formatAuth(auth: DesktopStatus["auth"]) {
  return auth
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}

function formatAllowance(used: number, limit: number | null) {
  return `${used.toLocaleString()} / ${limit === null ? "Unlimited" : limit.toLocaleString()}`;
}

function formatThemeMode(mode: ThemeMode) {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function formatPlanName(planId: string) {
  return planId.charAt(0).toUpperCase() + planId.slice(1);
}

function describeLocalInference(status: LocalInferenceStatus, error: string | null): { label: string; description: string } {
  if (error) return { label: "Download failed", description: error };
  switch (status.status) {
    case "ready":
      return { label: "Ready", description: "Generated on this Mac." };
    case "starting":
    case "stopped":
      return { label: "Starting", description: "Preparing Automatic Suggestions." };
    case "downloading":
      return {
        label: status.progress === null ? "Downloading" : `Downloading ${Math.round(status.progress * 100)}%`,
        description: "Keep Tab open while the local model downloads.",
      };
    case "unavailable":
      return {
        label: status.reason === "missing_model" ? "Download required" : "Unavailable",
        description: status.reason === "missing_model"
          ? "Download the local model to use Automatic Suggestions."
          : "Automatic Suggestions are unavailable. Try again or relaunch Tab.",
      };
  }
}

function describeUpdate(state: DesktopUpdateState): { label: string; description: string; tone: "brand" | "neutral" | "success" | "warning" } {
  switch (state.status) {
    case "idle":
      return { label: "Ready to check", description: "Check GitHub Releases for a newer signed version of Tab.", tone: "neutral" };
    case "checking":
      return { label: "Checking", description: "Looking for the latest version of Tab.", tone: "neutral" };
    case "not-available":
      return { label: "Up to date", description: `Tab ${state.currentVersion} is the latest version.`, tone: "success" };
    case "available":
      return { label: "Available", description: `Tab ${state.version} is ready to download.`, tone: "warning" };
    case "downloading":
      return { label: `${Math.round(state.percent)}%`, description: `Downloading Tab ${state.version}. Keep Tab open.`, tone: "brand" };
    case "downloaded":
      return { label: "Ready to install", description: `Restart Tab to install version ${state.version}.`, tone: "success" };
    case "error":
      return { label: "Try again", description: state.message, tone: "warning" };
  }
}

function createFallbackStatus(): DesktopStatus {
  return {
    auth: "sign_in_required",
    connectivity: "online",
    userId: null,
    entitlement: null,
    overlay: "hidden",
    lastUpdatedAt: null,
  };
}

export function SettingsSurface() {
  const [hydrationState, setHydrationState] = useState<"loading" | "ready" | "error">("loading");
  const [activeTab, setActiveTab] = useState<SettingsTab>("account");
  const [themeMode, setThemeMode] = useState<ThemeMode>(
    () => getStoredThemePreference(window.localStorage) ?? "system",
  );
  const [status, setStatus] = useState<DesktopStatus>(() => createFallbackStatus());
  const [memories, setMemories] = useState<PersonalMemory[]>([]);
  const [paused, setPaused] = useState(false);
  const [usePersonalMemory, setUsePersonalMemory] = useState(false);
  const [continuousMemoryExtraction, setContinuousMemoryExtraction] = useState(false);
  const [customWritingInstructions, setCustomWritingInstructions] = useState("");
  const [localInferenceStatus, setLocalInferenceStatus] = useState<LocalInferenceStatus>({ status: "stopped" });
  const [modelDownloadError, setModelDownloadError] = useState<string | null>(null);
  const [completionHistory, setCompletionHistory] = useState<readonly CompletionHistoryEntry[]>([]);
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState<"accessibility" | "input-monitoring" | null>(null);
  const [updateState, setUpdateState] = useState<DesktopUpdateState>({ status: "idle", currentVersion: "0.0.0" });
  const activeTabConfig = SETTINGS_TABS.find((tab) => tab.value === activeTab);
  const pauseState = describePauseState(paused);
  const localInference = describeLocalInference(localInferenceStatus, modelDownloadError);
  const update = describeUpdate(updateState);

  const refreshAccessibility = useCallback(async () => {
    if (!window.tab?.checkAccessibilityPermission) return false;
    const granted = Boolean(await window.tab.checkAccessibilityPermission());
    setAccessibilityGranted(granted);
    return granted;
  }, []);

  useEffect(() => {
    if (!window.tab) return;

    const unsubscribeStatus = window.tab.onStatusChanged((nextStatus) => {
      setStatus(nextStatus);
    });
    const unsubscribeMemories = window.tab.onMemoriesChanged((nextMemories) => setMemories(nextMemories));
    const unsubscribePause = window.tab.onPauseChanged((nextPaused) => setPaused(nextPaused));
    const unsubscribePreferences = window.tab.onPreferencesChanged((nextPreferences) => {
      setUsePersonalMemory(nextPreferences.suggestions.usePersonalMemory);
      setContinuousMemoryExtraction(nextPreferences.suggestions.continuousMemoryExtraction);
      setCustomWritingInstructions(nextPreferences.suggestions.customWritingInstructions);
    });
    let receivedLocalInferenceStatus = false;
    const unsubscribeLocalInference = window.tab.onLocalInferenceStatusChanged((status) => {
      receivedLocalInferenceStatus = true;
      setLocalInferenceStatus(status);
    });
    let receivedCompletionHistory = false;
    const unsubscribeCompletionHistory = window.tab.onCompletionHistoryChanged?.((entries) => {
      receivedCompletionHistory = true;
      setCompletionHistory(entries);
    }) ?? (() => {});
    let receivedUpdateState = false;
    const unsubscribeUpdateState = window.tab.onUpdateStateChanged((nextState) => {
      receivedUpdateState = true;
      setUpdateState(nextState);
    });

    window.tab
      .getInitialState()
      .then((initialState: InitialState) => {
        setStatus(initialState.status);
        setMemories(initialState.memories);
        setPaused(initialState.paused);
        setUsePersonalMemory(initialState.preferences.suggestions.usePersonalMemory);
        setContinuousMemoryExtraction(initialState.preferences.suggestions.continuousMemoryExtraction);
        setCustomWritingInstructions(initialState.preferences.suggestions.customWritingInstructions);
        if (!receivedLocalInferenceStatus) setLocalInferenceStatus(initialState.localInferenceStatus);
        if (!receivedCompletionHistory) setCompletionHistory(initialState.completionHistory ?? []);
        if (!receivedUpdateState) setUpdateState(initialState.updateState);
        setHydrationState("ready");
      })
      .catch(() => setHydrationState("error"));

    refreshAccessibility().catch(() => setAccessibilityGranted(false));
    return () => {
      unsubscribeStatus();
      unsubscribeMemories();
      unsubscribePause();
      unsubscribePreferences();
      unsubscribeLocalInference();
      unsubscribeCompletionHistory();
      unsubscribeUpdateState();
    };
  }, [refreshAccessibility]);

  async function handleAccessibility() {
    setPermissionBusy("accessibility");
    try {
      const alreadyGranted = Boolean(await window.tab?.openAccessibilitySettings?.());
      setAccessibilityGranted(alreadyGranted);
      if (!alreadyGranted) {
        window.setTimeout(() => {
          refreshAccessibility().catch(() => {});
        }, 1200);
      }
    } finally {
      setPermissionBusy(null);
    }
  }

  async function handleInputMonitoring() {
    setPermissionBusy("input-monitoring");
    try {
      await window.tab?.openInputMonitoringSettings?.();
      await window.tab?.revealAppInFinder?.();
    } finally {
      setPermissionBusy(null);
    }
  }

  function handleUsePersonalMemory(nextEnabled: boolean) {
    setUsePersonalMemory(nextEnabled);
    window.tab?.setUsePersonalMemoryForSuggestions?.(nextEnabled);
  }

  function handleContinuousMemoryExtraction(nextEnabled: boolean) {
    setContinuousMemoryExtraction(nextEnabled);
    window.tab?.setContinuousMemoryExtraction?.(nextEnabled);
  }

  function handleCustomWritingInstructions(value: string) {
    setCustomWritingInstructions(value);
    window.tab?.setCustomWritingInstructions?.(value);
  }

  function handleThemeMode(nextMode: ThemeMode) {
    setThemeMode(nextMode);
    setThemePreference(nextMode);
  }

  function handleSuggestionsEnabled(nextEnabled: boolean) {
    if (nextEnabled === paused) window.tab?.togglePause?.();
  }

  async function handleDownloadModel() {
    setModelDownloadError(null);
    try {
      await window.tab.downloadLocalModel();
    } catch {
      setModelDownloadError("The model could not be downloaded. Check your connection and try again.");
    }
  }

  async function handleUpdateAction() {
    try {
      if (updateState.status === "available") {
        await window.tab.downloadUpdate();
      } else if (updateState.status === "downloaded") {
        await window.tab.installUpdate();
      } else {
        await window.tab.checkForUpdates();
      }
    } catch {
      // The main process publishes a user-facing error state.
    }
  }

  function renderActiveTab() {
    switch (activeTab) {
      case "account":
        return (
          <>
            {status.entitlement ? (
              <div className="settings-summary">
                <SummaryMetric label="Plan" value={formatPlanName(status.entitlement.planId)} detail={status.entitlement.trial.active ? `Trial ends ${formatDate(status.entitlement.trial.endsAt)}` : "Current tier"} />
                <SummaryMetric label="Accepted Words today" value={formatAllowance(status.entitlement.localAcceptedWords.used, status.entitlement.localAcceptedWords.limit)} detail={`Resets ${formatDate(status.entitlement.localAcceptedWords.resetAt)}`} />
                <SummaryMetric label="Deep Completes" value={formatAllowance(status.entitlement.deepCompletes.used, status.entitlement.deepCompletes.limit)} detail={`Resets ${formatDate(status.entitlement.deepCompletes.resetAt)}`} />
                <SummaryMetric label="Words completed" value={(status.localSuggestionActivity?.acceptedWords ?? 0).toLocaleString()} detail="This month" />
              </div>
            ) : null}
            <SettingsGroup title="Connection" description="Account access for this Mac.">
              <StatusRow
                label="This Mac"
                value={formatAuth(status.auth)}
                tone={getAuthStatusRowTone(status.auth)}
                description="Connection to your Tab account."
              />
              <StatusRow
                label="Account services"
                value={status.connectivity === "online" ? "Online" : "Offline"}
                tone={status.connectivity === "online" ? "success" : "warning"}
                description="Used for Deep Complete and Personal Memory sync."
              />
              <div className="settings-group__actions">
                {status.entitlement?.upgradeUrl ? (
                  <Button onClick={() => window.tab?.openPricing?.()}>
                    View plans
                  </Button>
                ) : null}
                {status.auth === "signed_in" ? (
                  <Button variant="secondary" onClick={() => window.tab?.signOut?.()}>
                    Sign out
                  </Button>
                ) : (
                  <Button onClick={() => window.tab?.signIn?.()}>Sign in</Button>
                )}
              </div>
            </SettingsGroup>
          </>
        );

      case "controls":
        return (
          <SettingsGroup title="Automatic Suggestions" description="Control Suggestions on this Mac.">
            <SettingsRow label="Status" description={pauseState.description}>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <StatusBadge tone={paused ? "warning" : "brand"}>{pauseState.label}</StatusBadge>
                <Switch
                  aria-label="Automatic Suggestions"
                  checked={!paused}
                  onCheckedChange={handleSuggestionsEnabled}
                />
              </div>
            </SettingsRow>
            <SettingsRow
              label="Local model"
              description={localInference.description}
            >
              <div className="flex flex-wrap items-center justify-end gap-2">
                <StatusBadge tone={localInferenceStatus.status === "ready" ? "success" : "warning"}>
                  {localInference.label}
                </StatusBadge>
                {localInferenceStatus.status === "unavailable"
                  && ["missing_model", "artifact_mismatch", "download_failed"].includes(localInferenceStatus.reason) && (
                  <Button onClick={handleDownloadModel}>Download model</Button>
                )}
              </div>
            </SettingsRow>
            <SettingsRow
              className="settings-row--stacked"
              label="Custom writing instructions"
              description={status.entitlement?.capabilities.customWritingInstructions
                ? "Used for Local Suggestions and Deep Complete. Not included in telemetry."
                : "Available during the Pro trial and on a paid plan."}
            >
              <Textarea
                aria-label="Custom writing instructions"
                className="min-h-20 w-full max-w-md"
                disabled={!status.entitlement?.capabilities.customWritingInstructions}
                maxLength={1_000}
                onChange={(event) => handleCustomWritingInstructions(event.target.value)}
                placeholder="For example: Keep the tone concise and direct."
                value={customWritingInstructions}
              />
            </SettingsRow>
          </SettingsGroup>
        );

      case "completions":
        return (
          <SettingsGroup
            className="completion-history"
            title="This session"
            description={`${completionHistory.length} ${completionHistory.length === 1 ? "suggestion" : "suggestions"}. Cleared when Tab quits.`}
          >
            {completionHistory.length === 0 ? (
              <EmptyState className="m-4 mt-0" title="No Suggestions yet" description="Suggestions from this session will appear here." />
            ) : (
              <div className="completion-history__list" role="list" aria-label="Suggestion history">
                <div className="completion-history__columns" aria-hidden="true">
                  <span>Type and time</span>
                  <span>Context</span>
                  <span>Suggestion</span>
                </div>
                {completionHistory.map((entry) => (
                  <article className="completion-history__row" key={entry.id} role="listitem">
                    <div className="completion-history__meta">
                      <StatusBadge
                        className="px-2 py-0.5 text-[10px]"
                        tone={entry.mode === "local" ? "neutral" : "brand"}
                      >
                        {entry.mode === "local" ? "Local" : "Deep Complete"}
                      </StatusBadge>
                      <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleTimeString()}</time>
                    </div>
                    <div className="completion-history__preview completion-history__preview--context">
                      <span>Context</span>
                      <pre title={entry.input}>{entry.input}</pre>
                    </div>
                    <div className="completion-history__preview">
                      <span>Suggestion</span>
                      <pre title={entry.output}>{entry.output}</pre>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </SettingsGroup>
        );

      case "appearance":
        return (
          <SettingsGroup title="Theme" description="Stored on this Mac.">
            <SettingsRow label="Theme" description={themeMode === "system" ? "Follows macOS." : `Always uses ${themeMode} mode.`}>
              <ToggleGroup
                aria-label="Theme preference"
                className="settings-theme-toggle"
                onValueChange={(value) => {
                  if (value) handleThemeMode(value as ThemeMode);
                }}
                type="single"
                value={themeMode}
              >
                {THEME_MODES.map((mode) => (
                  <ToggleGroupItem aria-label={`Use ${formatThemeMode(mode)} theme`} key={mode} value={mode}>
                    {formatThemeMode(mode)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </SettingsRow>
          </SettingsGroup>
        );

      case "permissions":
        return (
          <>
            <SettingsGroup title="macOS access" description="Required to show and insert Suggestions in other apps.">
              <SettingsRow
                label="Accessibility"
                description="Required to read the text field you are using and add suggestions you accept."
              >
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <StatusBadge tone={accessibilityGranted ? "success" : "warning"}>
                    {accessibilityGranted ? "Enabled" : "Needs access"}
                  </StatusBadge>
                  {accessibilityGranted ? null : <Button disabled={permissionBusy === "accessibility"} onClick={handleAccessibility}>Open System Settings</Button>}
                </div>
              </SettingsRow>
              <SettingsRow
                label="Input Monitoring"
                description="Required to notice typing and make Option+Tab work when you accept a suggestion."
              >
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <StatusBadge tone="neutral">Check in System Settings</StatusBadge>
                  <Button disabled={permissionBusy === "input-monitoring"} onClick={handleInputMonitoring}>
                    Open System Settings
                  </Button>
                </div>
              </SettingsRow>
              <div className="settings-group__actions">
                <Button variant="secondary" onClick={() => window.tab?.relaunchForPermissions?.()}>
                  Relaunch Tab
                </Button>
              </div>
            </SettingsGroup>
            <SettingsGroup title="Privacy" description="Access Tab does not request.">
              <StatusRow
                label="Screen and file access"
                value="Not requested"
                description="Tab does not request Screen Recording or Full Disk Access. Recent typing is used to make suggestions, and saved memories stay visible and controlled by you."
              />
              <StatusRow
                label={APP_CONTEXT_TRUST_COPY.title}
                value="Suggestion-only"
                description={`${APP_CONTEXT_TRUST_COPY.summary} ${APP_CONTEXT_TRUST_COPY.permissionScope}`}
              />
            </SettingsGroup>
            {import.meta.env.DEV ? (
              <CommandBlock
                command="bun run desktop:permissions"
                label="Developer permission reset"
                description="If macOS shows Electron in dev mode, enable Tab with this helper, then relaunch."
              />
            ) : null}
          </>
        );

      case "memory":
        return (
          <>
            <SettingsGroup title="Use in Suggestions" description="Choose how Personal Memory is used on this Mac.">
              <SettingsRow
                label="Use Personal Memory in Suggestions"
                description={
                  usePersonalMemory
                    ? "Tab can use saved details when making Suggestions."
                    : "Saved details stay stored and editable, but Tab will not use them."
                }
              >
                <div className="flex items-center justify-end gap-2">
                  <StatusBadge tone={usePersonalMemory ? "brand" : "neutral"}>{usePersonalMemory ? "On" : "Off"}</StatusBadge>
                  <Switch
                    aria-label="Use Personal Memory in Suggestions"
                    checked={usePersonalMemory}
                    onCheckedChange={handleUsePersonalMemory}
                  />
                </div>
              </SettingsRow>
              <SettingsRow
                label="Automatically create Personal Memory"
                description={status.entitlement?.capabilities.continuousMemoryExtraction
                  ? "Save relevant details from eligible writing in the background."
                  : "Available during the Pro trial and on a paid plan. Existing Personal Memory stays manageable."}
              >
                <div className="flex items-center justify-end gap-2">
                  <StatusBadge tone={continuousMemoryExtraction ? "brand" : "neutral"}>{continuousMemoryExtraction ? "On" : "Off"}</StatusBadge>
                  <Switch
                  aria-label="Automatically create Personal Memory"
                    checked={continuousMemoryExtraction}
                    disabled={!status.entitlement?.capabilities.continuousMemoryExtraction}
                    onCheckedChange={handleContinuousMemoryExtraction}
                  />
                </div>
              </SettingsRow>
              <StatusRow label="Nearby app text" value="Not saved by default" description="Nearby app text is temporary and does not create Personal Memory by default." />
              {import.meta.env.DEV ? (
                <StatusRow
                  label="Supported nearby app text"
                  value={APP_CONTEXT_SUPPORTED_APP_MATRIX.map((entry) => entry.app).join(", ")}
                  description={APP_CONTEXT_TRUST_COPY.debugScope}
                />
              ) : null}
            </SettingsGroup>
            <SettingsGroup
              title="Saved details"
              description={`${memories.length.toLocaleString()} saved ${memories.length === 1 ? "detail" : "details"}.`}
            >
              {memories.length === 0 ? (
                <EmptyState
                  title="No Personal Memory yet"
                  description="Details Tab learns from eligible writing will appear here."
                />
              ) : (
                memories.map((memory) => (
                  <div className="memory-row" key={memory.id}>
                    <div className="min-w-0">
                      <p className="text-sm leading-relaxed">{memory.content}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{describePersonalMemorySource(memory.createdBy)}</p>
                    </div>
                    <Button aria-label={`Delete memory: ${memory.content}`} className="text-destructive hover:text-destructive" variant="ghost" size="sm" onClick={() => window.tab?.deleteMemory?.(memory.id)}>
                      Delete
                    </Button>
                  </div>
                ))
              )}
            </SettingsGroup>
          </>
        );

      case "updates": {
        const busy = updateState.status === "checking" || updateState.status === "downloading";
        const actionLabel = updateState.status === "available"
          ? "Download Update"
          : updateState.status === "downloaded"
            ? "Restart and Install"
            : updateState.status === "checking"
              ? "Checking..."
              : updateState.status === "downloading"
                ? `Downloading ${Math.round(updateState.percent)}%`
                : "Check for Updates";

        return (
          <SettingsGroup title="Software updates" description="Updates are downloaded from signed Tab releases on GitHub.">
            <StatusRow
              label="Installed version"
              value={updateState.currentVersion}
              description="The version currently running on this Mac."
            />
            <SettingsRow label="Update status" description={update.description}>
              <StatusBadge tone={update.tone}>{update.label}</StatusBadge>
            </SettingsRow>
            <div className="settings-group__actions">
              <Button disabled={busy} onClick={handleUpdateAction}>{actionLabel}</Button>
            </div>
          </SettingsGroup>
        );
      }
    }
  }

  return (
    <main className="desktop-shell">
      <Tabs orientation="vertical" value={activeTab} onValueChange={(value) => setActiveTab(value as SettingsTab)} className="h-full">
        <div className="settings-tabs grid h-full overflow-hidden">
          <aside className="settings-tabs__sidebar drag-region">
            <div className="settings-tabs__brand">
              <TabMark />
              <div>
                <strong>Tab</strong>
                <span>Autocomplete for Mac</span>
              </div>
            </div>

            <TabsList className="settings-tabs__nav no-drag h-auto rounded-none border-0 bg-transparent p-0 text-inherit" aria-label="Settings sections">
              {SETTINGS_TABS.map((tab) => (
                <TabsTrigger className="settings-tabs__item" key={tab.value} value={tab.value}>
                  <span className="settings-tabs__item-label">{tab.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            <div className="settings-tabs__switcher no-drag">
              <div>
                <strong>Enable Tab</strong>
                <span>{paused ? "Suggestions are off" : "Suggestions are on"}</span>
              </div>
              <Switch
                aria-label="Enable Tab"
                checked={!paused}
                onCheckedChange={handleSuggestionsEnabled}
              />
            </div>
          </aside>

          <section className="settings-tabs__main no-drag">
            <header className="settings-tabs__header drag-region">
               <h1>{activeTabConfig?.label}</h1>
              <p>{activeTabConfig?.description}</p>
            </header>

            <div className="settings-tabs__content">
              {["available", "downloading", "downloaded"].includes(updateState.status) ? (
                <div className="settings-paused">
                  <div>
                    <strong>{updateState.status === "downloaded" ? "Update ready to install" : "A Tab update is available"}</strong>
                    <span>{update.description}</span>
                  </div>
                  <Button
                    disabled={updateState.status === "downloading"}
                    size="sm"
                    onClick={handleUpdateAction}
                  >
                    {updateState.status === "available"
                      ? "Download Update"
                      : updateState.status === "downloaded"
                        ? "Restart and Install"
                        : "percent" in updateState
                          ? `${Math.round(updateState.percent)}%`
                          : "Update"}
                  </Button>
                </div>
              ) : null}
              {paused && activeTab !== "controls" ? (
                <div className="settings-paused">
                  <div>
                    <strong>Suggestions are paused</strong>
                    <span>{pauseState.description}</span>
                  </div>
                  <Button size="sm" onClick={() => window.tab?.togglePause?.()}>
                    Resume
                  </Button>
                </div>
              ) : null}
              {hydrationState === "ready" ? SETTINGS_TABS.map((tab) => (
                <TabsContent className="settings-tabs__panel" key={tab.value} value={tab.value}>
                  {activeTab === tab.value ? renderActiveTab() : null}
                </TabsContent>
              )) : (
                <EmptyState
                  title={hydrationState === "loading" ? "Loading settings" : "Settings unavailable"}
                  description={hydrationState === "loading" ? "Reading this Mac's current Tab settings." : "Quit and reopen Tab to try again."}
                />
              )}
            </div>
          </section>
        </div>
      </Tabs>
    </main>
  );
}
