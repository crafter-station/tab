import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CommandBlock,
  ComponentReviewSurface,
  EmptyState,
  Eyebrow,
  FloatingSuggestionBar,
  SectionBlock,
  SettingsNav,
  SettingsRow,
  StatusRow,
  SuggestionCommand,
  SurfaceHeader,
  TabMark,
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
    const suggestionShellOpeningTag = suggestionMarkup.match(/<section[^>]*>/)?.[0] ?? "";
    const suggestionButtonOpeningTag = suggestionMarkup.match(/<button[^>]*>/)?.[0] ?? "";
    const suggestionShellClasses = suggestionShellOpeningTag.match(/class="([^"]*)"/)?.[1].split(" ") ?? [];
    const suggestionButtonClasses = suggestionButtonOpeningTag.match(/class="([^"]*)"/)?.[1].split(" ") ?? [];

    expect(suggestionMarkup).toInclude('class="overlay-shell"');
    expect(suggestionButtonClasses).toContain("pointer-events-auto");
    expect(suggestionMarkup).toInclude("Option+Tab");
    expect(suggestionButtonOpeningTag).toMatch(/\stype="button"(?:\s|>)/);
    expect(suggestionShellClasses).toContain("visible");
    expect(suggestionShellClasses).not.toContain("transition-opacity");
    expect(suggestionShellOpeningTag).toMatch(/\saria-hidden="false"(?:\s|>)/);

    const hiddenSuggestionMarkup = renderToStaticMarkup(
      <FloatingSuggestionBar suggestion={null} onAccept={() => {}} />,
    );
    const hiddenShellOpeningTag = hiddenSuggestionMarkup.match(/<section[^>]*>/)?.[0] ?? "";
    const hiddenButtonOpeningTag = hiddenSuggestionMarkup.match(/<button[^>]*>/)?.[0] ?? "";
    const hiddenShellClasses = hiddenShellOpeningTag.match(/class="([^"]*)"/)?.[1].split(" ") ?? [];

    expect(hiddenShellClasses).toContain("invisible");
    expect(hiddenShellClasses).not.toContain("visible");
    expect(hiddenShellOpeningTag).toMatch(/\saria-hidden="true"(?:\s|>)/);
    expect(hiddenButtonOpeningTag).toMatch(/\sdisabled=""(?:\s|>)/);
  });

  it("marks cloud suggestions with their source icon", () => {
    const markup = renderToStaticMarkup(
      <FloatingSuggestionBar
        suggestion={{ id: "s-cloud", text: " from the cloud" }}
        source="cloud"
        onAccept={() => {}}
      />,
    );

    expect(markup).toInclude('data-source="cloud"');
    expect(markup).toInclude("<svg");
  });

  it("keeps suggestion content mounted while a cloud replacement loads", () => {
    const markup = renderToStaticMarkup(
      <FloatingSuggestionBar
        suggestion={{ id: "s-local", text: " local suggestion" }}
        source="local"
        loading
        onAccept={() => {}}
      />,
    );

    expect(markup).toInclude(" local suggestion");
    expect(markup).toInclude('data-loading="true"');
    expect(markup).toInclude('data-source="local"');
    expect(markup).toInclude("blur-[1px]");
    expect(markup).not.toInclude("<svg");
  });

  it("shares identity and suggestion recipes across embedded and native surfaces", () => {
    const markup = renderToStaticMarkup(
      <div>
        <TabMark />
        <Eyebrow>Native autocomplete</Eyebrow>
        <SuggestionCommand suggestion="Finish the thought." aria-label="Accept sample suggestion" />
      </div>,
    );

    expect(markup).toInclude("Native autocomplete");
    expect(markup).toInclude("Finish the thought.");
    expect(markup).toInclude("data-suggestion-command");
    expect(markup).toInclude("Option+Tab");
  });
});
