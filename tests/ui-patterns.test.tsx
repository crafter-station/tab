import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  CommandBlock,
  ComponentReviewSurface,
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
  it("renders accessible dialog titles and descriptions", () => {
    const markup = renderToStaticMarkup(
      <div>
        <Dialog>
          <DialogHeader>
            <DialogTitle>Edit memory</DialogTitle>
            <DialogDescription>Update what Tab remembers.</DialogDescription>
          </DialogHeader>
        </Dialog>
        <AlertDialog>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete memory?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
        </AlertDialog>
      </div>,
    );

    expect(markup).toInclude("Edit memory");
    expect(markup).toInclude("Update what Tab remembers.");
    expect(markup).toInclude("Delete memory?");
    expect(markup).toInclude("This action cannot be undone.");
  });

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

  it("uses the same logo with a restrained cloud material treatment", async () => {
    const markup = renderToStaticMarkup(
      <FloatingSuggestionBar
        suggestion={{ id: "s-cloud", text: " from the cloud" }}
        source="cloud"
        onAccept={() => {}}
      />,
    );
    const styles = await Bun.file(new URL("../packages/ui/src/styles/globals.css", import.meta.url)).text();

    expect(markup).toInclude('data-source="cloud"');
    expect(markup).toInclude("tab-suggestion-command");
    expect(markup).toInclude("tab-suggestion-source");
    expect(markup).toInclude('data-tab-mark="continuation-gap"');
    expect(markup).toInclude("Accept Deep Complete suggestion");
    expect(markup).not.toInclude(">Deep Complete<");
    expect(markup).not.toInclude(">Tab<");
    expect(markup).not.toInclude("data-source-glyph");
    expect(styles).toInclude("--tab-overlay-deep-bg: rgba(27, 26, 24, 0.97)");
    expect(styles).toInclude("radial-gradient(circle at 26px 50%, var(--tab-overlay-deep-wash), transparent 104px)");
    expect(styles).toInclude('.tab-suggestion-command[data-source="cloud"]::before');
    expect(styles).toInclude("--tab-overlay-deep-shortcut-bg: rgba(255, 255, 255, 0.07)");
    expect(styles).toInclude("background-color: var(--tab-overlay-deep-shortcut-bg)");
  });

  it("keeps suggestion content mounted and blurred while a replacement refreshes", () => {
    const markup = renderToStaticMarkup(
      <FloatingSuggestionBar
        suggestion={{ id: "s-local", text: " local suggestion" }}
        source="local"
        refreshing
        onAccept={() => {}}
      />,
    );

    expect(markup).toInclude(" local suggestion");
    expect(markup).toInclude('data-refreshing="true"');
    expect(markup).toInclude('aria-busy="true"');
    expect(markup).toInclude('data-source="local"');
    expect(markup).not.toInclude("Updating...");
    expect(markup).toInclude("tab-suggestion-content");
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
    expect(markup).toInclude('data-tab-mark="continuation-gap"');
    expect(markup).toInclude('viewBox="0 0 24 24"');
    expect(markup).toInclude("Option+Tab");
  });
});
