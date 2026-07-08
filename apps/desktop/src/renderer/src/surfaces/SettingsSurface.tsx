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
  Switch,
  SurfaceHeader,
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
import { APP_CONTEXT_SUPPORTED_APP_MATRIX, APP_CONTEXT_TRUST_COPY } from "../../../main/app-context";
import { describePauseState, describePersonalMemorySource } from "./settingsCopy";

type InitialState = Awaited<ReturnType<NonNullable<typeof window.tab>["getInitialState"]>>;
type SettingsTab = "account" | "controls" | "appearance" | "permissions" | "memory";

const SETTINGS_TABS: { value: SettingsTab; label: string; description: string }[] = [
  { value: "account", label: "Account", description: "Sign-in, usage, and connection" },
  { value: "controls", label: "Controls", description: "Pause or resume Tab" },
  { value: "appearance", label: "Appearance", description: "Theme follows this Mac by default" },
  { value: "permissions", label: "Permissions", description: "macOS access required by Tab" },
  { value: "memory", label: "Memory", description: "Saved details" },
];

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

function formatQuota(status: DesktopStatus) {
  if (!status.quota) return "Not available";
  return `${status.quota.usage.toLocaleString()} / ${status.quota.quota.toLocaleString()}`;
}

function describeQuota(status: DesktopStatus) {
  if (!status.quota) return "Monthly usage appears after sign-in.";
  return `Monthly suggestions reset ${formatDate(status.quota.resetAt)}.`;
}

function getQuotaStatusRowTone(status: DesktopStatus) {
  return status.quota?.exhausted ? "warning" : "neutral";
}

function formatThemeMode(mode: ThemeMode) {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
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
    if (!window.tab?.checkAccessibilityPermission) return false;
    const granted = Boolean(await window.tab.checkAccessibilityPermission());
    setAccessibilityGranted(granted);
    return granted;
  }, []);

  useEffect(() => {
    if (!window.tab) return;

    window.tab.onStatusChanged((nextStatus) => setStatus(nextStatus));
    window.tab.onMemoriesChanged((nextMemories) => setMemories(nextMemories));
    window.tab.onPauseChanged((nextPaused) => setPaused(nextPaused));
    window.tab.onPreferencesChanged((nextPreferences) => {
      setUsePersonalMemory(nextPreferences.suggestions.usePersonalMemory);
    });

    window.tab
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
          <Card className="settings-pane shadow-none">
            <CardHeader>
              <CardTitle>Account</CardTitle>
              <CardDescription>Sign-in, monthly suggestions, and connection status for this Mac.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <StatusRow
                label="Account status"
                value={formatAuth(status.auth)}
                tone={getAuthStatusRowTone(status.auth)}
                description="Whether this Mac is connected to your Tab account."
              />
              <StatusRow
                label="Plan"
                value={status.quota?.planId ?? "Not available"}
                description="The plan used for suggestions on this Mac."
              />
              <StatusRow
                label="Monthly suggestions"
                value={formatQuota(status)}
                tone={getQuotaStatusRowTone(status)}
                description={describeQuota(status)}
              />
              <StatusRow
                label="Connectivity"
                value={status.connectivity}
                tone={status.connectivity === "online" ? "success" : "warning"}
                description="Whether Tab can reach your account and sync saved memories."
              />
              <div className="pt-4">
                {status.auth === "signed_in" ? (
                  <Button variant="secondary" onClick={() => window.tab?.signOut?.()}>
                    Sign out
                  </Button>
                ) : (
                  <Button onClick={() => window.tab?.signIn?.()}>Sign in</Button>
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
              <CardDescription>Pause suggestions without signing out.</CardDescription>
            </CardHeader>
            <CardContent>
              <SettingsRow label="Suggestions" description={pauseState.description}>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <StatusBadge tone={paused ? "warning" : "ok"}>{pauseState.label}</StatusBadge>
                  <Button variant={paused ? "default" : "secondary"} onClick={() => window.tab?.togglePause?.()}>
                    {pauseState.action}
                  </Button>
                </div>
              </SettingsRow>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Pause keeps your account connected while stopping recent typing checks and suggestion bar updates.
              </p>
            </CardContent>
          </Card>
        );

      case "appearance":
        return (
          <Card className="settings-pane shadow-none">
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>Use your macOS theme by default, or keep Tab pinned to light or dark.</CardDescription>
            </CardHeader>
            <CardContent>
              <SettingsRow label="Theme" description="Theme preference is stored locally on this Mac.">
                <ToggleGroup
                  aria-label="Theme preference"
                  className="flex flex-wrap justify-end gap-2"
                  onValueChange={(value) => {
                    if (value) handleThemeMode(value as ThemeMode);
                  }}
                  type="single"
                  value={themeMode}
                  variant="outline"
                >
                  {THEME_MODES.map((mode) => (
                    <ToggleGroupItem
                      aria-label={`Use ${formatThemeMode(mode)} theme`}
                      key={mode}
                      value={mode}
                    >
                      {formatThemeMode(mode)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
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
                Accessibility lets Tab read the text field you are using and add suggestions you accept. Input Monitoring
                helps Tab notice typing and make Option+Tab work.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <SettingsRow
                label="Accessibility"
                description="Required to read the text field you are using and add suggestions you accept."
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
                description="Required to notice typing and make Option+Tab work when you accept a suggestion."
              >
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <StatusBadge tone="warning">Manual</StatusBadge>
                  <Button disabled={permissionBusy === "input-monitoring"} onClick={handleInputMonitoring}>
                    Open Settings
                  </Button>
                  <Button variant="secondary" onClick={() => window.tab?.relaunchForPermissions?.()}>
                    Relaunch Tab
                  </Button>
                </div>
              </SettingsRow>
              <StatusRow
                label="Privacy boundary"
                value="You stay in control"
                description="Tab does not request Screen Recording or Full Disk Access. Recent typing is used to make suggestions, and saved memories stay visible and controlled by you."
              />
              <StatusRow
                label={APP_CONTEXT_TRUST_COPY.title}
                value="Suggestion-only"
                description={`${APP_CONTEXT_TRUST_COPY.summary} ${APP_CONTEXT_TRUST_COPY.permissionScope}`}
              />
              {import.meta.env.DEV ? (
                <CommandBlock
                  command="bun run desktop:permissions"
                  label="Developer permission reset"
                  description="If macOS shows Electron in dev mode, enable Tab with this helper, then relaunch."
                />
              ) : null}
            </CardContent>
          </Card>
        );

      case "memory":
        return (
          <Card className="settings-pane shadow-none">
            <CardHeader>
              <CardTitle>Saved memories</CardTitle>
              <CardDescription>Turn saved memories on or off for suggestions on this Mac.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <SettingsRow
                label="Use saved memories in suggestions"
                description={
                  usePersonalMemory
                    ? "Tab can include saved memories when making suggestions."
                    : "Tab will ignore saved memories when making suggestions. Your memories stay stored and editable."
                }
              >
                <div className="flex items-center justify-end gap-2">
                  <StatusBadge tone={usePersonalMemory ? "ok" : "muted"}>{usePersonalMemory ? "On" : "Off"}</StatusBadge>
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
                      <p className="mt-1 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                        Saved memory - {describePersonalMemorySource(memory.createdBy)}
                      </p>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => window.tab?.deleteMemory?.(memory.id)}>
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
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as SettingsTab)} className="h-full">
        <SectionCard className="settings-tabs mx-auto grid h-full max-w-5xl overflow-hidden p-0">
          <aside className="settings-tabs__sidebar drag-region">
            <div className="settings-tabs__brand">
              <div className="settings-tabs__mark">T</div>
              <div>
                <p className="eyebrow">Tab</p>
                <h1>Settings</h1>
              </div>
            </div>

            <TabsList className="settings-tabs__nav no-drag h-auto bg-transparent p-0 text-inherit" aria-label="Settings sections">
              {SETTINGS_TABS.map((tab) => (
                <TabsTrigger className="settings-tabs__item" key={tab.value} value={tab.value}>
                  <span className="settings-tabs__item-label">{tab.label}</span>
                  <span className="settings-tabs__item-desc">{tab.description}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </aside>

          <div className="no-drag flex min-h-0 flex-col overflow-hidden">
            <div className="settings-tabs__header drag-region">
              <SurfaceHeader
                eyebrow={activeTabConfig?.label}
                title="Control Tab for Mac."
                description="Manage account status, suggestions, macOS permissions, monthly usage, connection, and saved memories from this Mac."
              />
            </div>

            <div className="settings-tabs__content">
              {paused ? (
                <StatusRow
                  label="Tab is paused"
                  value={pauseState.label}
                  tone="warning"
                  description={pauseState.description}
                />
              ) : null}
              <TabsContent value={activeTab} forceMount className="m-0">
                {renderActiveTab()}
              </TabsContent>
            </div>
          </div>
        </SectionCard>
      </Tabs>
    </main>
  );
}
