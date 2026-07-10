import { useCallback, useEffect, useState } from "react";
import {
  Button,
  CommandBlock,
  EmptyState,
  Eyebrow,
  SectionCard,
  SettingsGroup,
  SettingsRow,
  StatusBadge,
  StatusRow,
  SummaryMetric,
  Switch,
  TabMark,
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
  type SemanticTone,
} from "@tab/ui";
import type { PersonalMemory } from "@tab/contracts";
import type { DesktopStatus } from "../../../main/status";
import { APP_CONTEXT_SUPPORTED_APP_MATRIX, APP_CONTEXT_TRUST_COPY } from "../../../main/app-context";
import { describePauseState, describePersonalMemorySource } from "./settingsCopy";

type InitialState = Awaited<ReturnType<NonNullable<typeof window.tab>["getInitialState"]>>;
type SettingsTab = "account" | "controls" | "appearance" | "permissions" | "memory";
type SidebarStatus = { label: string; detail: string; tone: SemanticTone };

const SETTINGS_TABS: { value: SettingsTab; label: string; description: string }[] = [
  { value: "account", label: "Account", description: "Plan, usage, and connection for this Mac." },
  { value: "controls", label: "Controls", description: "Choose when Tab can offer suggestions." },
  { value: "appearance", label: "Appearance", description: "Set how Tab looks on this Mac." },
  { value: "permissions", label: "Permissions", description: "Review the macOS access Tab needs." },
  { value: "memory", label: "Memory", description: "Control personal context used in suggestions." },
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

function formatQuota(status: DesktopStatus) {
  if (!status.quota) return "Not available";
  return `${status.quota.usage.toLocaleString()} / ${status.quota.quota.toLocaleString()}`;
}

function formatThemeMode(mode: ThemeMode) {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function formatPlanName(planId: string) {
  return planId.charAt(0).toUpperCase() + planId.slice(1);
}

function getSidebarStatus(status: DesktopStatus, paused: boolean, loaded: boolean): SidebarStatus {
  if (!loaded) return { label: "Checking Tab...", detail: "Loading current status", tone: "neutral" };
  if (status.connectivity !== "online") return { label: "Tab is offline", detail: "Waiting for a connection", tone: "warning" };
  if (status.auth === "revoked_device") return { label: "Reconnect Tab", detail: "Access was removed", tone: "destructive" };
  if (status.auth !== "signed_in") return { label: "Sign in required", detail: "Connect this Mac", tone: "warning" };
  if (status.quota?.exhausted) return { label: "Monthly limit reached", detail: "Suggestions are unavailable", tone: "warning" };
  if (paused) return { label: "Suggestions paused", detail: "Resume from Controls", tone: "warning" };
  return { label: "Tab is ready", detail: "Suggestions are active", tone: "success" };
}

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

export function SettingsSurface() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("account");
  const [themeMode, setThemeMode] = useState<ThemeMode>(
    () => getStoredThemePreference(window.localStorage) ?? "system",
  );
  const [status, setStatus] = useState<DesktopStatus>(() => createFallbackStatus());
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [memories, setMemories] = useState<PersonalMemory[]>([]);
  const [paused, setPaused] = useState(false);
  const [usePersonalMemory, setUsePersonalMemory] = useState(false);
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState<"accessibility" | "input-monitoring" | null>(null);
  const activeTabConfig = SETTINGS_TABS.find((tab) => tab.value === activeTab);
  const pauseState = describePauseState(paused);
  const sidebarStatus = getSidebarStatus(status, paused, statusLoaded);

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
      setStatusLoaded(true);
    });
    const unsubscribeMemories = window.tab.onMemoriesChanged((nextMemories) => setMemories(nextMemories));
    const unsubscribePause = window.tab.onPauseChanged((nextPaused) => setPaused(nextPaused));
    const unsubscribePreferences = window.tab.onPreferencesChanged((nextPreferences) => {
      setUsePersonalMemory(nextPreferences.suggestions.usePersonalMemory);
    });

    window.tab
      .getInitialState()
      .then((initialState: InitialState) => {
        setStatus(initialState.status);
        setStatusLoaded(true);
        setMemories(initialState.memories);
        setPaused(initialState.paused);
        setUsePersonalMemory(initialState.preferences.suggestions.usePersonalMemory);
      })
      .catch(() => {});

    refreshAccessibility().catch(() => setAccessibilityGranted(false));
    return () => {
      unsubscribeStatus();
      unsubscribeMemories();
      unsubscribePause();
      unsubscribePreferences();
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

  function handleThemeMode(nextMode: ThemeMode) {
    setThemeMode(nextMode);
    setThemePreference(nextMode);
  }

  function renderActiveTab() {
    switch (activeTab) {
      case "account":
        return (
          <>
            <div className="settings-summary">
              <SummaryMetric
                label="Account"
                value={status.auth === "signed_in" ? "Connected" : formatAuth(status.auth)}
                detail="This Mac"
              />
              <SummaryMetric label="Plan" value={status.quota ? formatPlanName(status.quota.planId) : "Not available"} detail="Current tier" />
              <SummaryMetric
                label="Monthly suggestions"
                value={formatQuota(status)}
                detail={status.quota ? `Resets ${formatDate(status.quota.resetAt)}` : "Available after sign-in"}
              />
            </div>
            <SettingsGroup title="Connection" description="Account and network state for this installation of Tab.">
              <StatusRow
                label="Account status"
                value={formatAuth(status.auth)}
                tone={getAuthStatusRowTone(status.auth)}
                description="Whether this Mac is connected to your Tab account."
              />
              <StatusRow
                label="Connectivity"
                value={status.connectivity === "online" ? "Online" : "Offline"}
                tone={status.connectivity === "online" ? "success" : "warning"}
                description="Whether Tab can reach your account and sync saved memories."
              />
              <div className="settings-group__actions">
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
          <SettingsGroup title="Suggestions" description="Pause autocomplete without disconnecting your account.">
            <SettingsRow label="Pause suggestions" description={pauseState.description}>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <StatusBadge tone={paused ? "warning" : "success"}>{pauseState.label}</StatusBadge>
                <Switch
                  aria-label="Pause suggestions"
                  checked={paused}
                  onCheckedChange={(nextPaused) => {
                    if (nextPaused !== paused) window.tab?.togglePause?.();
                  }}
                />
              </div>
            </SettingsRow>
            <StatusRow
              label="While paused"
              value={paused ? "No suggestions" : "Autocomplete active"}
              tone={paused ? "warning" : "success"}
              description="Your account stays connected. Tab stops checking recent typing and hides the suggestion bar."
            />
          </SettingsGroup>
        );

      case "appearance":
        return (
          <SettingsGroup title="Theme" description="Use the system appearance or keep Tab pinned to one theme.">
            <SettingsRow label="Appearance" description="Theme preference is stored locally on this Mac.">
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
            <StatusRow
              label="Current preference"
              value={formatThemeMode(themeMode)}
              description={themeMode === "system" ? "Tab changes with macOS appearance." : `Tab stays in ${themeMode} mode.`}
            />
          </SettingsGroup>
        );

      case "permissions":
        return (
          <>
            <SettingsGroup title="macOS access" description="Tab only asks for access needed to observe typing and insert accepted suggestions.">
              <SettingsRow
                label="Accessibility"
                description="Required to read the text field you are using and add suggestions you accept."
              >
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <StatusBadge tone={accessibilityGranted ? "success" : "warning"}>
                    {accessibilityGranted ? "Enabled" : "Needs access"}
                  </StatusBadge>
                  <Button disabled={permissionBusy === "accessibility"} onClick={handleAccessibility}>
                    {accessibilityGranted ? "Reopen Settings" : "Open Settings"}
                  </Button>
                </div>
              </SettingsRow>
              <SettingsRow
                label="Input Monitoring"
                description="Required to notice typing and make Option+Tab work when you accept a suggestion."
              >
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <StatusBadge tone="warning">Manual</StatusBadge>
                  <Button disabled={permissionBusy === "input-monitoring"} onClick={handleInputMonitoring}>
                    Open Settings
                  </Button>
                </div>
              </SettingsRow>
              <div className="settings-group__actions">
                <Button variant="secondary" onClick={() => window.tab?.relaunchForPermissions?.()}>
                  Relaunch after permission changes
                </Button>
              </div>
            </SettingsGroup>
            <SettingsGroup title="Privacy boundary" description="The permissions Tab does not request matter just as much.">
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
            <SettingsGroup title="Personalization" description="Choose whether saved details can inform suggestions on this Mac.">
              <SettingsRow
                label="Use saved memories in suggestions"
                description={
                  usePersonalMemory
                    ? "Tab can include saved memories when making suggestions."
                    : "Tab will ignore saved memories when making suggestions. Your memories stay stored and editable."
                }
              >
                <div className="flex items-center justify-end gap-2">
                  <StatusBadge tone={usePersonalMemory ? "success" : "neutral"}>{usePersonalMemory ? "On" : "Off"}</StatusBadge>
                  <Switch
                    aria-label="Use saved memories in suggestions"
                    checked={usePersonalMemory}
                    onCheckedChange={handleUsePersonalMemory}
                  />
                </div>
              </SettingsRow>
              <StatusRow label="Nearby app text" value="Not saved as memory" description={APP_CONTEXT_TRUST_COPY.memoryScope} />
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
              description={`${memories.length.toLocaleString()} ${memories.length === 1 ? "memory" : "memories"} available to this account.`}
            >
              {memories.length === 0 ? (
                <EmptyState
                  title="No saved memories yet"
                  description="When saved memories exist, each row remains readable and deletable from this Mac."
                />
              ) : (
                memories.map((memory) => (
                  <div className="memory-row" key={memory.id}>
                    <div className="min-w-0">
                      <p className="text-sm leading-relaxed">{memory.content}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Saved by {describePersonalMemorySource(memory.createdBy)}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => window.tab?.deleteMemory?.(memory.id)}>
                      Delete
                    </Button>
                  </div>
                ))
              )}
            </SettingsGroup>
          </>
        );
    }
  }

  return (
    <main className="desktop-shell">
      <Tabs orientation="vertical" value={activeTab} onValueChange={(value) => setActiveTab(value as SettingsTab)} className="h-full">
        <SectionCard className="settings-tabs mx-auto grid h-full max-w-5xl overflow-hidden p-0">
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

            <div
              className="settings-tabs__status no-drag"
              data-tone={sidebarStatus.tone}
            >
              <span className="settings-tabs__status-dot" aria-hidden="true" />
              <div>
                <strong>
                  {sidebarStatus.label}
                </strong>
                <span>{sidebarStatus.detail}</span>
              </div>
            </div>
          </aside>

          <section className="settings-tabs__main no-drag">
            <header className="settings-tabs__header drag-region">
              <Eyebrow>Settings</Eyebrow>
              <h1>{activeTabConfig?.label}</h1>
              <p>{activeTabConfig?.description}</p>
            </header>

            <div className="settings-tabs__content">
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
              {SETTINGS_TABS.map((tab) => (
                <TabsContent className="settings-tabs__panel" key={tab.value} value={tab.value}>
                  {activeTab === tab.value ? renderActiveTab() : null}
                </TabsContent>
              ))}
            </div>
          </section>
        </SectionCard>
      </Tabs>
    </main>
  );
}
