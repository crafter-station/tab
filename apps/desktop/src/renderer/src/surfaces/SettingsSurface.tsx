import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CommandBlock,
  EmptyState,
  SectionCard,
  SettingsRow,
  StatusBadge,
  StatusRow,
  SurfaceHeader,
  THEME_MODES,
  getStoredThemePreference,
  setThemePreference,
  type ThemeMode,
} from "@tabb/ui";
import type { PersonalMemory } from "@tabb/contracts";
import type { DesktopStatus } from "../../../main/status";

type InitialState = Awaited<ReturnType<NonNullable<typeof window.tabb>["getInitialState"]>>;
type SettingsTab = "account" | "controls" | "appearance" | "permissions" | "memory";

const SETTINGS_TABS: { value: SettingsTab; label: string; description: string }[] = [
  { value: "account", label: "Account", description: "Sign-in, quota, and connectivity" },
  { value: "controls", label: "Controls", description: "Pause or resume observation" },
  { value: "appearance", label: "Appearance", description: "Theme follows this Mac by default" },
  { value: "permissions", label: "Permissions", description: "macOS access required by Tabb" },
  { value: "memory", label: "Memory", description: "Personalization snippets" },
];

export function describePauseState(paused: boolean) {
  return paused
    ? {
        label: "Paused",
        description: "Typing Context observation and Suggestions are disabled.",
        action: "Resume Tabb",
      }
    : {
        label: "Active",
        description: "Typing Context observation and Suggestions are running.",
        action: "Pause Tabb",
      };
}

function getAuthStatusRowTone(auth: DesktopStatus["auth"]) {
  if (auth === "signed_in") return "success";
  if (auth === "revoked_device") return "warning";
  return "neutral";
}

function formatAuth(auth: DesktopStatus["auth"]) {
  return auth.replace(/_/g, " ");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
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
  const [memories, setMemories] = useState<PersonalMemory[]>([]);
  const [paused, setPaused] = useState(false);
  const [usePersonalMemory, setUsePersonalMemory] = useState(false);
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState<"accessibility" | "input-monitoring" | null>(null);
  const activeTabConfig = SETTINGS_TABS.find((tab) => tab.value === activeTab);
  const pauseState = describePauseState(paused);

  const refreshAccessibility = useCallback(async () => {
    if (!window.tabb?.checkAccessibilityPermission) return false;
    const granted = Boolean(await window.tabb.checkAccessibilityPermission());
    setAccessibilityGranted(granted);
    return granted;
  }, []);

  useEffect(() => {
    if (!window.tabb) return;

    window.tabb.onStatusChanged((nextStatus) => setStatus(nextStatus));
    window.tabb.onMemoriesChanged((nextMemories) => setMemories(nextMemories));
    window.tabb.onPauseChanged((nextPaused) => setPaused(nextPaused));
    window.tabb.onPreferencesChanged((nextPreferences) => {
      setUsePersonalMemory(nextPreferences.suggestions.usePersonalMemory);
    });

    window.tabb
      .getInitialState()
      .then((initialState: InitialState) => {
        setStatus(initialState.status);
        setMemories(initialState.memories);
        setPaused(initialState.paused);
        setUsePersonalMemory(initialState.preferences.suggestions.usePersonalMemory);
      })
      .catch(() => {});

    refreshAccessibility().catch(() => setAccessibilityGranted(false));
  }, [refreshAccessibility]);

  async function handleAccessibility() {
    setPermissionBusy("accessibility");
    try {
      const alreadyGranted = Boolean(await window.tabb?.openAccessibilitySettings?.());
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
      await window.tabb?.openInputMonitoringSettings?.();
      await window.tabb?.revealAppInFinder?.();
    } finally {
      setPermissionBusy(null);
    }
  }

  function handleUsePersonalMemory(nextEnabled: boolean) {
    setUsePersonalMemory(nextEnabled);
    window.tabb?.setUsePersonalMemoryForSuggestions?.(nextEnabled);
  }

  function handleThemeMode(nextMode: ThemeMode) {
    setThemeMode(nextMode);
    setThemePreference(nextMode);
  }

  function renderActiveTab() {
    switch (activeTab) {
      case "account":
        return (
          <Card className="settings-pane shadow-none">
            <CardHeader>
              <CardTitle>Account</CardTitle>
              <CardDescription>Sign-in, quota, and device connectivity for this Mac.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <StatusRow
                label="Account status"
                value={formatAuth(status.auth)}
                tone={getAuthStatusRowTone(status.auth)}
                description="Authentication and device-token state for this Mac."
              />
              <StatusRow
                label="Plan"
                value={status.quota?.planId ?? "Not available"}
                description="The active entitlement used for desktop Suggestions."
              />
              <StatusRow
                label="Quota"
                value={
                  status.quota
                    ? `${status.quota.usage.toLocaleString()} / ${status.quota.quota.toLocaleString()}`
                    : "Not available"
                }
                tone={status.quota?.exhausted ? "warning" : "neutral"}
                description={status.quota ? `Suggestion quota resets ${formatDate(status.quota.resetAt)}.` : "Quota appears after sign-in."}
              />
              <StatusRow
                label="Connectivity"
                value={status.connectivity}
                tone={status.connectivity === "online" ? "success" : "warning"}
                description="Live API reachability for account, quota, and memory sync."
              />
              <div className="pt-4">
                {status.auth === "signed_in" ? (
                  <Button variant="secondary" onClick={() => window.tabb?.signOut?.()}>
                    Sign Out
                  </Button>
                ) : (
                  <Button onClick={() => window.tabb?.signIn?.()}>Sign In</Button>
                )}
              </div>
            </CardContent>
          </Card>
        );

      case "controls":
        return (
          <Card className="settings-pane shadow-none">
            <CardHeader>
              <CardTitle>Controls</CardTitle>
              <CardDescription>Pause Typing Context observation and Suggestions without signing out.</CardDescription>
            </CardHeader>
            <CardContent>
              <SettingsRow label="Typing Context and Suggestions" description={pauseState.description}>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <StatusBadge tone={paused ? "warning" : "ok"}>{pauseState.label}</StatusBadge>
                  <Button variant={paused ? "default" : "secondary"} onClick={() => window.tabb?.togglePause?.()}>
                    {pauseState.action}
                  </Button>
                </div>
              </SettingsRow>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Pause keeps your account connected while disabling local Typing Context observation and Floating Suggestion Overlay updates.
              </p>
            </CardContent>
          </Card>
        );

      case "appearance":
        return (
          <Card className="settings-pane shadow-none">
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>Use your macOS theme by default, or keep Tabb pinned to light or dark.</CardDescription>
            </CardHeader>
            <CardContent>
              <SettingsRow label="Theme" description="Theme preference is stored locally on this Mac.">
                <div className="flex flex-wrap justify-end gap-2">
                  {THEME_MODES.map((mode) => (
                    <Button
                      key={mode}
                      onClick={() => handleThemeMode(mode)}
                      type="button"
                      variant={themeMode === mode ? "default" : "secondary"}
                    >
                      {mode.charAt(0).toUpperCase() + mode.slice(1)}
                    </Button>
                  ))}
                </div>
              </SettingsRow>
            </CardContent>
          </Card>
        );

      case "permissions":
        return (
          <Card className="settings-pane shadow-none">
            <CardHeader>
              <CardTitle>Permissions</CardTitle>
              <CardDescription>
                Accessibility supports Text Session understanding and accepted Suggestion insertion. Input Monitoring
                supports typing timing, acceptance shortcuts, and fallback Typing Context signals.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <SettingsRow
                label="Accessibility"
                description="Required for Text Session understanding and reliable accepted Suggestion insertion."
              >
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <StatusBadge tone={accessibilityGranted ? "ok" : "warning"}>
                    {accessibilityGranted ? "Enabled" : "Needs access"}
                  </StatusBadge>
                  <Button disabled={permissionBusy === "accessibility"} onClick={handleAccessibility}>
                    {accessibilityGranted ? "Reopen Settings" : "Open Settings"}
                  </Button>
                </div>
              </SettingsRow>
              <SettingsRow
                label="Input Monitoring"
                description="Required for typing timing, Acceptance shortcuts, and fallback Typing Context signals."
              >
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <StatusBadge tone="warning">Manual</StatusBadge>
                  <Button disabled={permissionBusy === "input-monitoring"} onClick={handleInputMonitoring}>
                    Open Settings
                  </Button>
                  <Button variant="secondary" onClick={() => window.tabb?.relaunchForPermissions?.()}>
                    Relaunch Tabb
                  </Button>
                </div>
              </SettingsRow>
              <StatusRow
                label="Privacy boundary"
                value="Local control"
                description="Tabb does not request Screen Recording or Full Disk Access. Typing Context stays in memory only, Personal Memory stays visible and controlled by you, telemetry is metadata-only, and raw logs are not stored."
              />
              <CommandBlock
                command="bun run desktop:permissions"
                label="Development permission reset"
                description="If macOS shows Electron in dev mode, enable Tabb with this helper, then relaunch."
              />
            </CardContent>
          </Card>
        );

      case "memory":
        return (
          <Card className="settings-pane shadow-none">
            <CardHeader>
              <CardTitle>Personal Memory</CardTitle>
              <CardDescription>Control whether stored Personal Memory can personalize desktop Suggestions.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <SettingsRow
                label="Use in Suggestions"
                description="Pasted text can still inform the current Suggestion, but it is not saved to Personal Memory by default."
              >
                <Button
                  variant={usePersonalMemory ? "default" : "secondary"}
                  onClick={() => handleUsePersonalMemory(!usePersonalMemory)}
                >
                  {usePersonalMemory ? "Using Personal Memory" : "Do Not Use"}
                </Button>
              </SettingsRow>
              {memories.length === 0 ? (
                <EmptyState
                  title="No Personal Memory stored yet"
                  description="When Personal Memory exists, each row remains readable and deletable from this Mac."
                />
              ) : (
                memories.map((memory) => (
                  <div className="memory-row" key={memory.id}>
                    <div className="min-w-0">
                      <p className="text-sm leading-relaxed">{memory.content}</p>
                      <p className="mt-1 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                        Personal Memory - Created by {memory.createdBy}
                      </p>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => window.tabb?.deleteMemory?.(memory.id)}>
                      Delete
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        );
    }
  }

  return (
    <main className="desktop-shell">
      <SectionCard className="settings-tabs mx-auto grid h-full max-w-5xl overflow-hidden p-0">
        <aside className="settings-tabs__sidebar drag-region">
          <div className="settings-tabs__brand">
            <div className="settings-tabs__mark">T</div>
            <div>
              <p className="eyebrow">Tabb</p>
              <h1>Native utility settings</h1>
            </div>
          </div>

          <nav className="settings-tabs__nav no-drag" aria-label="Settings sections">
            {SETTINGS_TABS.map((tab) => (
              <button
                aria-current={activeTab === tab.value ? "page" : undefined}
                className="settings-tabs__item"
                data-active={activeTab === tab.value}
                key={tab.value}
                onClick={() => setActiveTab(tab.value)}
                type="button"
              >
                <span className="settings-tabs__item-label">{tab.label}</span>
                <span className="settings-tabs__item-desc">{tab.description}</span>
              </button>
            ))}
          </nav>
        </aside>

        <div className="no-drag flex min-h-0 flex-col overflow-hidden">
          <div className="settings-tabs__header drag-region">
            <SurfaceHeader
              eyebrow={activeTabConfig?.label}
              title="Control your Native Autocomplete App."
              description="Account status, Typing Context controls, macOS permissions, quota, connectivity, and Personal Memory stay local, visible, and reversible from this Mac."
            />
          </div>

          <div className="settings-tabs__content">
            {paused ? (
              <StatusRow label="Tabb is paused" value={pauseState.label} tone="warning" description={pauseState.description} />
            ) : null}
            {renderActiveTab()}
          </div>
        </div>
      </SectionCard>
    </main>
  );
}
