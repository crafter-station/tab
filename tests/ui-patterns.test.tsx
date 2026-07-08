import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CommandBlock,
  ComponentReviewSurface,
  EmptyState,
  FloatingSuggestionBar,
  SectionBlock,
  SettingsNav,
  SettingsRow,
  StatusRow,
  SurfaceHeader,
} from "../packages/ui/src/index.ts";
import { DebugContextCard } from "../apps/desktop/src/renderer/src/components/DebugContextCard.tsx";

describe("shared app patterns", () => {
  it("renders reviewable Tab patterns in light and dark modes", () => {
    const markup = renderToStaticMarkup(<ComponentReviewSurface />);

    expect(markup).toInclude("Shared primitive review");
    expect(markup).toInclude('data-theme="light"');
    expect(markup).toInclude('data-theme="dark"');
    expect(markup).toInclude("Status rows");
    expect(markup).toInclude("Settings navigation");
    expect(markup).toInclude("Primitive controls");
    expect(markup).toInclude("Email input");
    expect(markup).toInclude("Plan table");
    expect(markup).toInclude("Tooltip guidance");
    expect(markup).toInclude("No saved memories yet");
    expect(markup).toInclude("Developer diagnostics");
  });

  it("renders app-level patterns with semantic labels and actions", () => {
    const markup = renderToStaticMarkup(
      <SectionBlock>
        <SurfaceHeader eyebrow="Account" title="Control plane" description="Manage Tab." />
        <StatusRow label="Native app" value="Connected" tone="success" />
        <SettingsNav items={[{ label: "General", href: "#general", active: true }]} />
        <SettingsRow label="Saved memories" description="Keep suggestions personal.">
          Enabled
        </SettingsRow>
        <CommandBlock command="tab://debug" label="Debug command" />
        <EmptyState title="No devices linked" description="Sign in from the Mac app." action="Download for macOS" />
      </SectionBlock>,
    );

    expect(markup).toInclude("Control plane");
    expect(markup).toInclude("Connected");
    expect(markup).toInclude("aria-current=\"page\"");
    expect(markup).toInclude("Debug command");
    expect(markup).toInclude("Download for macOS");
  });

  it("keeps the floating suggestion overlay inert except for acceptance controls", () => {
    const suggestionMarkup = renderToStaticMarkup(
      <main className="overlay-shell">
        <FloatingSuggestionBar suggestion={{ id: "s-1", text: " world" }} onAccept={() => {}} />
        <DebugContextCard debug={null} />
      </main>,
    );

    expect(suggestionMarkup).toInclude('class="overlay-shell"');
    expect(suggestionMarkup).toInclude("pointer-events-auto");
    expect(suggestionMarkup).toInclude("Option+Tab");
    expect(suggestionMarkup).toInclude("type=\"button\"");
    expect(suggestionMarkup).toInclude("aria-hidden=\"true\"");
  });
});
