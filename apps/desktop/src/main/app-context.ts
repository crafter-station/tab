import type { ActiveApplication, AppContext, AppContextFragment } from "@tab/contracts";
import {
  normalizeAppContext,
  type AppContextCandidate,
  type AppContextCandidateFragment,
  type AppContextCandidateRequestPayloadPolicy,
} from "./app-context-policy.ts";
import type { SafeTypingContextSnapshot, TextSessionSnapshot } from "./typing-context.ts";

const MAX_FRAGMENT_LENGTH = 2_000;
const MAX_EXTRACTED_TEXT_LENGTH = 1_500;
const MAX_OBSIDIAN_DOCUMENT_CONTEXT_LENGTH = 1_600;
const MAX_OBSIDIAN_CONTEXT_BEFORE_CARET = 1_000;
const MIN_ACCESSIBILITY_CONFIDENCE = 0.7;
const ACCESSIBILITY_TEXT_FIELDS = ["value", "title", "description"] as const;
const MIN_PROVIDER_CONFIDENCE = 0.65;
const GHOSTTY_BUNDLE_ID = "com.mitchellh.ghostty";
const GHOSTTY_PROVIDER = "ghostty-terminal";
const MIN_GHOSTTY_CONTEXT_LENGTH = 20;
const MAX_GHOSTTY_CONTEXT_LINES = 16;
const MAX_CONTROL_CHARACTER_RATIO = 0.08;
const ANSI_OSC_SEQUENCE = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;
const ANSI_CSI_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const NON_WHITESPACE_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
const OBSIDIAN_PROVIDER = "obsidian-accessibility-editor";
const OBSIDIAN_BUNDLE_IDS = new Set(["md.obsidian"]);
const OBSIDIAN_CONTEXT_CONFIDENCE = 0.88;
const MISSING_OBSIDIAN_EDITOR_SEMANTICS_REASON = "missing_focused_editor_semantics";
const NOISY_OBSIDIAN_EXTRACTION_REASON = "noisy_extraction";
const ZED_PROVIDER = "zed-focused-editor";
const ZED_BUNDLE_IDS = new Set(["dev.zed.Zed", "dev.zed.Zed-Preview"]);
const ZED_CONTEXT_CONFIDENCE = 0.82;
const FOCUSED_EDITOR_BEFORE_CARET_RATIO = 0.7;
const MIN_EDITOR_CONTEXT_LENGTH = 8;
const CODE_LIKE_CONTEXT_SUPPRESSION_REASON = "code_like_context";
const COMMENT_LINE_MARKER_PATTERN = /^(\/\/|\/\*|\*|#|<!--)/;
const COMMENT_MARKER_PATTERN = /^(\/\/|\/\*+|\*|#+|<!--)\s*/;
const COMMENT_END_MARKER_PATTERN = /\s*(\*\/|-->)$/;
const PROSE_COMMENT_PATTERN = /[A-Za-z][A-Za-z\s,'-]{12,}/;
const CODE_LIKE_LINE_PATTERN = /[{};]|=>|^(function|const|let|var|return|import|export|class|if|for|while|switch|try|catch)\b/;
const CHROME_WEB_PROVIDER = "chrome-web-writing-context";
const CHROME_WEB_FOCUSED_EDITABLE_FRAGMENT_ID = "chrome-web-focused-editable";
const CHROME_WEB_NEARBY_VISIBLE_TEXT_FRAGMENT_ID = "chrome-web-nearby-visible-text";
const CHROME_WEB_FOCUSED_EDITABLE_REQUEST_PAYLOAD_POLICY = {
  maxLength: 1_000,
  preserveWholeWords: true,
} satisfies AppContextCandidateRequestPayloadPolicy;
const CHROME_WEB_NEARBY_VISIBLE_TEXT_REQUEST_PAYLOAD_POLICY = {
  maxLength: 1_500,
  preserveWholeWords: true,
} satisfies AppContextCandidateRequestPayloadPolicy;
const CHROME_BUNDLE_IDS = new Set([
  "com.google.Chrome",
  "com.google.Chrome.beta",
  "com.google.Chrome.canary",
  "com.google.Chrome.dev",
]);
const FOCUSED_EDITABLE_CONFIDENCE = 0.92;
const NEARBY_VISIBLE_TEXT_CONFIDENCE = 0.82;
const MAX_NEARBY_TEXT_NODES = 12;
const MAX_NEARBY_VERTICAL_DISTANCE = 1_200;
const URL_LIKE_PATTERN = /\b(?:https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,}(?:\/|$))/i;
const EDITABLE_ROLES = new Set(["AXTextArea", "AXTextField", "AXComboBox", "textbox", "textarea"]);
const SEMANTIC_TEXT_ROLES = new Set([
  "AXDocument",
  "AXGroup",
  "AXHeading",
  "AXStaticText",
  "AXTextArea",
  "AXTextField",
  "AXWebArea",
  "article",
  "document",
  "group",
  "heading",
  "paragraph",
  "section",
  "staticText",
  "textbox",
  "textarea",
]);
const AGGREGATE_TEXT_CONTAINER_ROLES = new Set([
  "AXDocument",
  "AXGroup",
  "AXWebArea",
  "article",
  "document",
  "group",
  "section",
]);
const EXCLUDED_WEB_ROLES = new Set([
  "AXAddressField",
  "AXButton",
  "AXCheckBox",
  "AXLink",
  "AXMenu",
  "AXMenuBar",
  "AXPopUpButton",
  "AXRadioButton",
  "AXScrollBar",
  "AXSearchField",
  "AXSidebar",
  "AXTabGroup",
  "AXToolbar",
  "button",
  "checkbox",
  "link",
  "menu",
  "navigation",
  "radio",
  "searchbox",
  "sidebar",
  "tablist",
  "toolbar",
]);

export type AppContextSnapshot = AppContext;

export type AppContextProvider = () => AppContextSnapshot;

export type AccessibilityContextNode = {
  readonly role?: string;
  readonly title?: string;
  readonly value?: string;
  readonly description?: string;
  readonly children?: readonly AccessibilityContextNode[];
};

export type AccessibilityAppContextInput = {
  readonly activeApplication: ActiveApplication | null;
  readonly focusedElement?: AccessibilityContextNode | null;
  readonly visibleRoot?: AccessibilityContextNode | null;
};

type ExtractableObsidianTextSession = TextSessionSnapshot & {
  readonly focusedElementId: string;
  readonly textElementId: string;
  readonly selectedRange: NonNullable<TextSessionSnapshot["selectedRange"]>;
  readonly surroundingContext: NonNullable<TextSessionSnapshot["surroundingContext"]>;
};

export type AppContextCandidateProvider = (snapshot: SafeTypingContextSnapshot) => AppContextCandidate;

export type ChromeWebAccessibilityNode = {
  readonly id?: string;
  readonly role?: string;
  readonly subrole?: string;
  readonly title?: string;
  readonly description?: string;
  readonly value?: string;
  readonly text?: string;
  readonly placeholder?: string;
  readonly focused?: boolean;
  readonly editable?: boolean;
  readonly hidden?: boolean;
  readonly enabled?: boolean;
  readonly bounds?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly children?: readonly ChromeWebAccessibilityNode[];
};

type ChromeWebAccessibilityBounds = NonNullable<ChromeWebAccessibilityNode["bounds"]>;

export type AccessibilityTextNode = {
  readonly role?: string;
  readonly value?: string;
  readonly title?: string;
  readonly description?: string;
  readonly children?: readonly AccessibilityTextNode[];
};

export type AppContextManager = {
  setCandidate(candidate: AppContextCandidate): void;
  getSnapshot(): AppContextSnapshot;
  clear(): void;
};

function emptyCandidate(status: AppContextSnapshot["metadata"]["status"]): AppContextCandidate {
  return { fragments: [], metadata: { status } };
}

type AppContextAdapter = {
  readonly provider: string;
  readonly kind: string;
  readonly confidence: number;
};

type SupportedAccessibilityAdapter = {
  readonly app: string;
  readonly bundleIds: readonly string[];
  readonly adapter: AppContextAdapter;
};

const SUPPORTED_ACCESSIBILITY_ADAPTERS: readonly SupportedAccessibilityAdapter[] = [
  {
    app: "WhatsApp",
    bundleIds: ["net.whatsapp.WhatsApp", "com.whatsapp.WhatsApp"],
    adapter: { provider: "whatsapp-accessibility", kind: "conversation", confidence: 0.86 },
  },
  {
    app: "Ghostty",
    bundleIds: ["com.mitchellh.ghostty"],
    adapter: { provider: "ghostty-accessibility", kind: "terminal_session", confidence: 0.72 },
  },
  {
    app: "Obsidian",
    bundleIds: ["md.obsidian"],
    adapter: { provider: "obsidian-accessibility", kind: "document", confidence: 0.78 },
  },
  {
    app: "Zed",
    bundleIds: ["dev.zed.Zed"],
    adapter: { provider: "zed-accessibility", kind: "editor", confidence: 0.74 },
  },
  {
    app: "Chrome",
    bundleIds: ["com.google.Chrome"],
    adapter: { provider: "chrome-accessibility", kind: "browser_writing_surface", confidence: 0.7 },
  },
  {
    app: "Apple Notes",
    bundleIds: ["com.apple.Notes"],
    adapter: { provider: "notes-accessibility", kind: "document", confidence: 0.78 },
  },
  {
    app: "Apple Mail",
    bundleIds: ["com.apple.mail"],
    adapter: { provider: "mail-accessibility", kind: "conversation", confidence: 0.74 },
  },
  {
    app: "Messages",
    bundleIds: ["com.apple.MobileSMS"],
    adapter: { provider: "messages-accessibility", kind: "conversation", confidence: 0.76 },
  },
  {
    app: "Slack",
    bundleIds: ["com.tinyspeck.slackmacgap"],
    adapter: { provider: "slack-accessibility", kind: "conversation", confidence: 0.72 },
  },
  {
    app: "Discord",
    bundleIds: ["com.hnc.Discord"],
    adapter: { provider: "discord-accessibility", kind: "conversation", confidence: 0.7 },
  },
  {
    app: "VS Code",
    bundleIds: ["com.microsoft.VSCode"],
    adapter: { provider: "vscode-accessibility", kind: "editor", confidence: 0.72 },
  },
  {
    app: "TextEdit",
    bundleIds: ["com.apple.TextEdit"],
    adapter: { provider: "textedit-accessibility", kind: "document", confidence: 0.8 },
  },
];

export const APP_CONTEXT_TRUST_COPY = {
  title: "Nearby app text",
  summary:
    "Nearby app text is temporary context from supported writing apps. It is used only to make suggestions.",
  permissionScope:
    "Tab uses Accessibility metadata and semantic text only. Tab does not request Screen Recording, Full Disk Access, raw logs, browser history, hidden DOM, screenshots, or file reads for it.",
  memoryScope:
    "Nearby app, conversation, document, web, and terminal text is not saved as memory by default. Saved memories remain based on eligible writing and explicit user control.",
  clearingScope:
    "Pause Tab or clear context to immediately clear recent typing and nearby app text. Nearby app text is also cleared on app/window changes, secure input, secret-like detection, sleep, lock, and quit.",
  debugScope:
    "Developer diagnostics show nearby app text status, provider, confidence, suppression reason, and supported-app allowlist state as metadata-only diagnostics.",
} as const;

export const APP_CONTEXT_SUPPORTED_APP_MATRIX = [
  ...SUPPORTED_ACCESSIBILITY_ADAPTERS.map((entry) => ({
    app: entry.app,
    provider: entry.adapter.provider,
    allowlisted: true,
    expectedKind: entry.adapter.kind,
  })),
] as const;

const NORMALIZED_ACCESSIBILITY_ADAPTERS: readonly SupportedAccessibilityAdapter[] =
  SUPPORTED_ACCESSIBILITY_ADAPTERS.map((entry) => ({
    ...entry,
    bundleIds: entry.bundleIds.map((bundleId) => bundleId.toLowerCase()),
  }));

function findAdapter(activeApplication: ActiveApplication | null): AppContextAdapter | null {
  if (!activeApplication) return null;
  const bundleId = activeApplication.bundleId.toLowerCase();
  const matchingEntry = NORMALIZED_ACCESSIBILITY_ADAPTERS.find((entry) =>
    entry.bundleIds.includes(bundleId),
  );

  return matchingEntry?.adapter ?? null;
}

function collectAccessibilityText(node: AccessibilityContextNode | null | undefined): string[] {
  const textValues: string[] = [];

  function visit(currentNode: AccessibilityContextNode | null | undefined): void {
    if (!currentNode) return;

    for (const value of [currentNode.value, currentNode.description, currentNode.title]) {
      const text = value?.replace(/\s+/g, " ").trim();
      if (text) textValues.push(text);
    }

    for (const child of currentNode.children ?? []) {
      visit(child);
    }
  }

  visit(node);
  return textValues;
}

function uniqueBoundedLines(lines: readonly string[]): string {
  const seen = new Set<string>();
  const uniqueLines: string[] = [];

  for (const line of lines) {
    if (seen.has(line)) continue;
    seen.add(line);
    uniqueLines.push(line);
  }

  return uniqueLines.join("\n").slice(0, MAX_FRAGMENT_LENGTH).trim();
}

function emptyProviderCandidate(
  provider: string,
  status: AppContextSnapshot["metadata"]["status"],
  suppressionReason?: string,
): AppContextCandidate {
  return {
    fragments: [],
    metadata: {
      provider,
      status,
      confidence: 0,
      ...(suppressionReason ? { suppressionReason } : {}),
    },
  };
}

function emptyObsidianCandidate(
  status: AppContextSnapshot["metadata"]["status"],
  suppressionReason?: string,
): AppContextCandidate {
  return emptyProviderCandidate(OBSIDIAN_PROVIDER, status, suppressionReason);
}

function emptyGhosttyCandidate(status: AppContextSnapshot["metadata"]["status"], confidence?: number): AppContextCandidate {
  return {
    fragments: [],
    metadata: { provider: GHOSTTY_PROVIDER, status, confidence },
  };
}

function stripAnsiControlSequences(text: string): string {
  return text
    .replace(ANSI_OSC_SEQUENCE, "")
    .replace(ANSI_CSI_SEQUENCE, "")
    .replace(NON_WHITESPACE_CONTROL_CHARACTERS, "");
}

function controlCharacterRatio(text: string): number {
  if (text.length === 0) return 0;
  const controls = text.match(CONTROL_CHARACTERS)?.length ?? 0;
  return controls / text.length;
}

function terminalSessionText(snapshot: TextSessionSnapshot): string {
  return [
    snapshot.surroundingContext?.beforeCaret ?? "",
    snapshot.selectedText ?? "",
    snapshot.surroundingContext?.afterCaret ?? "",
  ].filter(Boolean).join("\n");
}

function normalizeTerminalContext(text: string): string {
  return stripAnsiControlSequences(text)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(-MAX_GHOSTTY_CONTEXT_LINES)
    .join("\n")
    .trim()
    .slice(-MAX_FRAGMENT_LENGTH);
}

export function createGhosttyAppContextCandidate(snapshot: SafeTypingContextSnapshot): AppContextCandidate {
  if (snapshot.activeApplication?.bundleId !== GHOSTTY_BUNDLE_ID) {
    return emptyGhosttyCandidate("unsupported");
  }

  const textSession = snapshot.textSession;
  if (!textSession || textSession.accessibilityReliability !== "reliable" || textSession.secureLike) {
    return emptyGhosttyCandidate("empty", 0);
  }

  const rawContext = terminalSessionText(textSession);

  if (rawContext.trim().length === 0 || controlCharacterRatio(rawContext) > MAX_CONTROL_CHARACTER_RATIO) {
    return emptyGhosttyCandidate("empty", 0);
  }

  const text = normalizeTerminalContext(rawContext);
  if (text.length < MIN_GHOSTTY_CONTEXT_LENGTH) {
    return emptyGhosttyCandidate("empty", 0.4);
  }

  const confidence = 0.86;
  return {
    fragments: [
      {
        id: `ghostty:${snapshot.contextHash}`,
        provider: GHOSTTY_PROVIDER,
        kind: "terminal_visible_context",
        text,
        confidence,
      },
    ],
    metadata: { provider: GHOSTTY_PROVIDER, status: "available", confidence },
  };
}

type ProviderDefinition = {
  readonly provider: string;
  readonly kind: AppContextFragment["kind"];
  readonly confidence: number;
};

type AppSpecificProviderMatcher = {
  readonly bundleId: string;
  readonly definition: ProviderDefinition;
  readonly includeVariants?: boolean;
};

const APPLE_NOTES_PROVIDER: ProviderDefinition = {
  provider: "apple-notes-accessibility",
  kind: "focused_note",
  confidence: 0.88,
};

const SLACK_PROVIDER: ProviderDefinition = {
  provider: "slack-accessibility",
  kind: "conversation",
  confidence: 0.82,
};

const DISCORD_PROVIDER: ProviderDefinition = {
  provider: "discord-accessibility",
  kind: "conversation",
  confidence: 0.8,
};

const GENERIC_ACCESSIBILITY_PROVIDER: ProviderDefinition = {
  provider: "generic-accessibility-text",
  kind: "visible_text",
  confidence: 0.76,
};

const APP_SPECIFIC_PROVIDER_MATCHERS: readonly AppSpecificProviderMatcher[] = [
  { bundleId: "com.apple.Notes", definition: APPLE_NOTES_PROVIDER },
  { bundleId: "com.tinyspeck.slackmacgap", definition: SLACK_PROVIDER, includeVariants: true },
  { bundleId: "com.hnc.Discord", definition: DISCORD_PROVIDER, includeVariants: true },
];

const GENERIC_ACCESSIBILITY_APPS = new Set([
  "com.apple.mail",
  "com.apple.MobileSMS",
  "com.microsoft.VSCode",
  "com.apple.TextEdit",
]);

const GENERIC_ACCESSIBILITY_APP_PREFIXES = ["com.microsoft.VSCode", "com.visualstudio.code"] as const;

function matchesAppSpecificProvider(bundleId: string, matcher: AppSpecificProviderMatcher): boolean {
  return matcher.includeVariants ? bundleId.startsWith(matcher.bundleId) : bundleId === matcher.bundleId;
}

function collectAccessibilityTextValues(node: AccessibilityTextNode, values: string[]): void {
  for (const field of ACCESSIBILITY_TEXT_FIELDS) {
    const candidate = node[field];
    const normalized = candidate?.replace(/\s+/g, " ").trim();
    if (normalized) values.push(normalized);
  }

  for (const child of node.children ?? []) {
    collectAccessibilityTextValues(child, values);
  }
}

function extractBoundedAccessibilityText(root: AccessibilityTextNode): string {
  const values: string[] = [];
  collectAccessibilityTextValues(root, values);
  const deduplicatedValues = [...new Set(values)];
  return deduplicatedValues.join("\n").slice(0, MAX_EXTRACTED_TEXT_LENGTH).trim();
}

function genericProviderFor(activeApplication: ActiveApplication): ProviderDefinition | null {
  const bundleId = activeApplication.bundleId;
  const isGenericAccessibilityApp = GENERIC_ACCESSIBILITY_APPS.has(bundleId)
    || GENERIC_ACCESSIBILITY_APP_PREFIXES.some((prefix) => bundleId.startsWith(prefix));

  if (!isGenericAccessibilityApp) {
    return null;
  }

  return GENERIC_ACCESSIBILITY_PROVIDER;
}

function providerDefinitionFor(activeApplication: ActiveApplication): ProviderDefinition | null {
  const appSpecificProvider = APP_SPECIFIC_PROVIDER_MATCHERS.find((matcher) =>
    matchesAppSpecificProvider(activeApplication.bundleId, matcher),
  );

  return appSpecificProvider?.definition ?? genericProviderFor(activeApplication);
}

export function extractAppContextCandidateFromAccessibility(
  activeApplication: ActiveApplication | null,
  root: AccessibilityTextNode | null,
): AppContextCandidate {
  if (!activeApplication || !root) {
    return emptyCandidate("unsupported");
  }

  const definition = providerDefinitionFor(activeApplication);
  if (!definition) {
    return emptyCandidate("unsupported");
  }

  const text = extractBoundedAccessibilityText(root);
  const confidence = text.length >= 12 ? definition.confidence : 0.2;
  if (confidence < MIN_ACCESSIBILITY_CONFIDENCE) {
    return {
      fragments: [],
      metadata: {
        provider: definition.provider,
        status: "suppressed",
        confidence,
        suppressionReason: "low_confidence_accessibility_text",
      },
    };
  }

  return {
    fragments: [
      {
        id: `${definition.provider}:${activeApplication.bundleId}`,
        provider: definition.provider,
        kind: definition.kind,
        text,
        confidence,
      },
    ],
    metadata: {
      provider: definition.provider,
      status: "available",
      confidence,
    },
  };
}

function createEmptyZedCandidate(status: AppContextSnapshot["metadata"]["status"]): AppContextCandidate {
  return { fragments: [], metadata: { provider: ZED_PROVIDER, status } };
}

function createSuppressedZedCandidate(suppressionReason: string): AppContextCandidate {
  return { fragments: [], metadata: { provider: ZED_PROVIDER, status: "suppressed", suppressionReason } };
}

function chromeWebUnavailableCandidate(status: AppContextSnapshot["metadata"]["status"] = "unsupported"): AppContextCandidate {
  return { fragments: [], metadata: { provider: CHROME_WEB_PROVIDER, status } };
}

function isChromeApplication(activeApplication: ActiveApplication | null | undefined): boolean {
  return activeApplication ? CHROME_BUNDLE_IDS.has(activeApplication.bundleId) : false;
}

function nodeRole(node: ChromeWebAccessibilityNode): string {
  return node.role ?? node.subrole ?? "";
}

function nodeText(node: ChromeWebAccessibilityNode): string {
  for (const value of [node.value, node.text, node.title, node.description]) {
    if (typeof value !== "string") continue;

    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length > 0) return normalized;
  }

  return "";
}

function isVisibleNode(node: ChromeWebAccessibilityNode): boolean {
  return node.hidden !== true && node.enabled !== false;
}

function isExcludedWebNode(node: ChromeWebAccessibilityNode): boolean {
  const role = nodeRole(node);
  const nodeLabel = `${role} ${node.title ?? ""} ${node.description ?? ""} ${node.placeholder ?? ""}`.toLowerCase();

  return EXCLUDED_WEB_ROLES.has(role) || nodeLabel.includes("address") || nodeLabel.includes("url");
}

function isEditableNode(node: ChromeWebAccessibilityNode): boolean {
  return isVisibleNode(node) && (node.editable === true || EDITABLE_ROLES.has(nodeRole(node)));
}

function findFocusedEditableNode(node: ChromeWebAccessibilityNode, focusedElementId?: string): ChromeWebAccessibilityNode | null {
  if (!isVisibleNode(node)) return null;

  const matchesFocusedElement = Boolean(focusedElementId && node.id === focusedElementId);
  if ((node.focused === true || matchesFocusedElement) && isEditableNode(node)) {
    return node;
  }

  for (const child of node.children ?? []) {
    const focused = findFocusedEditableNode(child, focusedElementId);
    if (focused) return focused;
  }

  return null;
}

function verticalDistance(a: ChromeWebAccessibilityBounds, b: ChromeWebAccessibilityBounds): number {
  const aBottom = a.y + a.height;
  const bBottom = b.y + b.height;
  if (aBottom < b.y) return b.y - aBottom;
  if (bBottom < a.y) return a.y - bBottom;
  return 0;
}

function isNearbyNode(node: ChromeWebAccessibilityNode, focused: ChromeWebAccessibilityNode): boolean {
  if (!focused.bounds || !node.bounds) return true;
  return verticalDistance(node.bounds, focused.bounds) <= MAX_NEARBY_VERTICAL_DISTANCE;
}

function nearbyNodeText(node: ChromeWebAccessibilityNode, focused: ChromeWebAccessibilityNode): string {
  const role = nodeRole(node);
  const hasChildren = (node.children?.length ?? 0) > 0;
  if (hasChildren && AGGREGATE_TEXT_CONTAINER_ROLES.has(role)) return "";

  const text = nodeText(node);
  if (!text || !SEMANTIC_TEXT_ROLES.has(role) || !isNearbyNode(node, focused) || URL_LIKE_PATTERN.test(text)) return "";

  return text;
}

function collectNearbyVisibleText(
  node: ChromeWebAccessibilityNode,
  focused: ChromeWebAccessibilityNode,
  collected: string[],
): void {
  if (collected.length >= MAX_NEARBY_TEXT_NODES || !isVisibleNode(node) || isExcludedWebNode(node)) return;
  if (node === focused) return;

  const text = nearbyNodeText(node, focused);
  if (text) {
    collected.push(text);
    if (collected.length >= MAX_NEARBY_TEXT_NODES) return;
  }

  for (const child of node.children ?? []) {
    collectNearbyVisibleText(child, focused, collected);
    if (collected.length >= MAX_NEARBY_TEXT_NODES) return;
  }
}

function createChromeWebFragment(
  id: string,
  kind: AppContextFragment["kind"],
  text: string,
  confidence: number,
  requestPayloadPolicy: AppContextCandidateRequestPayloadPolicy,
): AppContextCandidateFragment | null {
  if (!text) return null;

  return {
    id,
    provider: CHROME_WEB_PROVIDER,
    kind,
    text,
    confidence,
    requestPayloadPolicy,
  };
}

export function createChromeWebWritingContextCandidate(input: {
  readonly activeApplication: ActiveApplication | null;
  readonly accessibilityTree: ChromeWebAccessibilityNode | null | undefined;
  readonly focusedElementId?: string;
}): AppContextCandidate {
  if (!isChromeApplication(input.activeApplication)) return chromeWebUnavailableCandidate();
  if (!input.accessibilityTree) return chromeWebUnavailableCandidate("empty");

  const focused = findFocusedEditableNode(input.accessibilityTree, input.focusedElementId);
  if (!focused) return chromeWebUnavailableCandidate("empty");

  const fragments: AppContextCandidateFragment[] = [];
  const focusedText = nodeText(focused);
  const focusedFragment = createChromeWebFragment(
    CHROME_WEB_FOCUSED_EDITABLE_FRAGMENT_ID,
    "focused_editable",
    focusedText,
    FOCUSED_EDITABLE_CONFIDENCE,
    CHROME_WEB_FOCUSED_EDITABLE_REQUEST_PAYLOAD_POLICY,
  );
  if (focusedFragment) fragments.push(focusedFragment);

  const nearbyText: string[] = [];
  collectNearbyVisibleText(input.accessibilityTree, focused, nearbyText);
  const nearbyFragment = createChromeWebFragment(
    CHROME_WEB_NEARBY_VISIBLE_TEXT_FRAGMENT_ID,
    "nearby_visible_text",
    nearbyText.join(" "),
    nearbyText.length > 0 ? NEARBY_VISIBLE_TEXT_CONFIDENCE : 0,
    CHROME_WEB_NEARBY_VISIBLE_TEXT_REQUEST_PAYLOAD_POLICY,
  );
  if (nearbyFragment) fragments.push(nearbyFragment);

  if (fragments.length === 0) return chromeWebUnavailableCandidate("empty");

  return {
    fragments,
    metadata: {
      provider: CHROME_WEB_PROVIDER,
      status: "available",
      confidence: Math.max(...fragments.map((fragment) => fragment.confidence)),
    },
  };
}

function isObsidianApplication(snapshot: TextSessionSnapshot): boolean {
  return OBSIDIAN_BUNDLE_IDS.has(snapshot.activeApplication?.bundleId ?? "");
}

function cleanAccessibilityText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n");
}

function isNoisyAccessibilityText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 12) return true;

  const replacementCount = (trimmed.match(/\ufffd/g) ?? []).length;
  return replacementCount > 4 && replacementCount / trimmed.length > 0.2;
}

function canExtractObsidianEditorContext(
  snapshot: TextSessionSnapshot,
): snapshot is ExtractableObsidianTextSession {
  return (
    !snapshot.secureLike &&
    snapshot.accessibilityReliability === "reliable" &&
    Boolean(snapshot.focusedElementId) &&
    Boolean(snapshot.textElementId) &&
    Boolean(snapshot.selectedRange) &&
    Boolean(snapshot.surroundingContext)
  );
}

function sliceObsidianContextBeforeCaret(text: string): string {
  if (text.length <= MAX_OBSIDIAN_CONTEXT_BEFORE_CARET) return text;
  const sliced = text.slice(-MAX_OBSIDIAN_CONTEXT_BEFORE_CARET);
  const headingMatches = Array.from(sliced.matchAll(/^#{1,6}\s.+$/gm));
  const nearestHeading = headingMatches.at(-1);
  if (nearestHeading?.index !== undefined) return sliced.slice(nearestHeading.index);

  const nextLine = sliced.indexOf("\n");
  return nextLine >= 0 ? sliced.slice(nextLine + 1) : sliced;
}

function sliceObsidianContextAfterCaret(text: string, remainingLength: number): string {
  const paragraphBreak = text.indexOf("\n\n");
  const lineBreak = text.indexOf("\n");
  const semanticBreak = paragraphBreak >= 0 ? paragraphBreak : lineBreak;
  const semanticSlice = semanticBreak >= 0 ? text.slice(0, semanticBreak) : text;
  if (semanticSlice.length <= remainingLength) return semanticSlice;

  const sliced = semanticSlice.slice(0, remainingLength);
  const previousLine = sliced.lastIndexOf("\n");
  return previousLine > 0 ? sliced.slice(0, previousLine) : sliced;
}

function boundedObsidianContext(beforeCaret: string, afterCaret: string): string {
  const before = sliceObsidianContextBeforeCaret(beforeCaret);
  const remaining = Math.max(0, MAX_OBSIDIAN_DOCUMENT_CONTEXT_LENGTH - before.length);
  const after = sliceObsidianContextAfterCaret(afterCaret, remaining);
  return cleanAccessibilityText(`${before}${after}`).trim();
}

function createObsidianFragment(snapshot: ExtractableObsidianTextSession, text: string): AppContextCandidateFragment {
  return {
    id: [
      OBSIDIAN_PROVIDER,
      snapshot.activeApplication?.windowId ?? "window-unknown",
      snapshot.focusedElementId,
      snapshot.textElementId,
      `${snapshot.selectedRange.location}:${snapshot.selectedRange.length}`,
    ].join(":"),
    provider: OBSIDIAN_PROVIDER,
    kind: "markdown_document",
    text,
    confidence: OBSIDIAN_CONTEXT_CONFIDENCE,
  };
}

export function createObsidianDocumentAppContextCandidate(snapshot: TextSessionSnapshot): AppContextCandidate {
  if (!isObsidianApplication(snapshot)) {
    return emptyObsidianCandidate("unsupported");
  }

  if (!canExtractObsidianEditorContext(snapshot)) {
    return emptyObsidianCandidate("empty", MISSING_OBSIDIAN_EDITOR_SEMANTICS_REASON);
  }

  const text = boundedObsidianContext(
    snapshot.surroundingContext.beforeCaret ?? "",
    snapshot.surroundingContext.afterCaret ?? "",
  );

  if (isNoisyAccessibilityText(text)) {
    return emptyObsidianCandidate("empty", NOISY_OBSIDIAN_EXTRACTION_REASON);
  }

  const fragment = createObsidianFragment(snapshot, text);

  return {
    fragments: [fragment],
    metadata: {
      provider: OBSIDIAN_PROVIDER,
      status: "available",
      confidence: fragment.confidence,
    },
  };
}

function takeTrailingText(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : text.slice(text.length - maxLength);
}

function takeLeadingText(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function buildBoundedFocusedEditorText(beforeCaret: string, afterCaret: string): string {
  const beforeCaretBudget = Math.ceil(MAX_FRAGMENT_LENGTH * FOCUSED_EDITOR_BEFORE_CARET_RATIO);
  const afterCaretBudget = MAX_FRAGMENT_LENGTH - beforeCaretBudget;
  const before = takeTrailingText(beforeCaret, beforeCaretBudget).trimStart();
  const after = takeLeadingText(afterCaret, afterCaretBudget).trimEnd();

  return [before, after].filter((part) => part.trim().length > 0).join("");
}

function isProseCommentLine(line: string): boolean {
  const trimmed = line.trim();
  if (!COMMENT_LINE_MARKER_PATTERN.test(trimmed)) return false;

  const withoutMarker = trimmed.replace(COMMENT_MARKER_PATTERN, "").replace(COMMENT_END_MARKER_PATTERN, "");
  return PROSE_COMMENT_PATTERN.test(withoutMarker);
}

function isCodeLikeFocusedEditorText(text: string): boolean {
  const meaningfulLines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (meaningfulLines.length < 3 || meaningfulLines.some(isProseCommentLine)) return false;

  const codeLikeLines = meaningfulLines.filter((line) => CODE_LIKE_LINE_PATTERN.test(line));

  return codeLikeLines.length >= 3 && codeLikeLines.length / meaningfulLines.length >= 0.6;
}

function isZedBundleId(bundleId: string | undefined): boolean {
  return bundleId ? ZED_BUNDLE_IDS.has(bundleId) : false;
}

export function createZedFocusedEditorAppContextCandidateProvider(): AppContextCandidateProvider {
  return (snapshot) => {
    const textSession = snapshot.textSession;
    if (!isZedBundleId(snapshot.activeApplication?.bundleId)) {
      return createEmptyZedCandidate("unsupported");
    }
    if (!textSession || textSession.accessibilityReliability !== "reliable" || textSession.secureLike) {
      return createEmptyZedCandidate("empty");
    }

    const beforeCaret = textSession.surroundingContext?.beforeCaret ?? "";
    const afterCaret = textSession.surroundingContext?.afterCaret ?? "";
    const text = buildBoundedFocusedEditorText(beforeCaret, afterCaret);
    if (text.trim().length < MIN_EDITOR_CONTEXT_LENGTH) {
      return createEmptyZedCandidate("empty");
    }
    if (isCodeLikeFocusedEditorText(text)) {
      return createSuppressedZedCandidate(CODE_LIKE_CONTEXT_SUPPRESSION_REASON);
    }

    return {
      fragments: [
        {
          id: `${ZED_PROVIDER}:${snapshot.contextHash}`,
          provider: ZED_PROVIDER,
          kind: "focused_editor",
          text,
          confidence: ZED_CONTEXT_CONFIDENCE,
        },
      ],
      metadata: {
        provider: ZED_PROVIDER,
        status: "available",
        confidence: ZED_CONTEXT_CONFIDENCE,
      },
    };
  };
}

export function createAppContextManager(): AppContextManager {
  let snapshot: AppContextSnapshot = normalizeAppContext(emptyCandidate("empty"));

  return {
    setCandidate(candidate) {
      snapshot = normalizeAppContext(candidate);
    },
    getSnapshot() {
      return snapshot;
    },
    clear() {
      snapshot = normalizeAppContext(emptyCandidate("cleared"));
    },
  };
}

export function createAccessibilityAppContextProvider(
  readInput: () => AccessibilityAppContextInput,
): AppContextProvider {
  return () => {
    const input = readInput();
    const adapter = findAdapter(input.activeApplication);
    if (!adapter) return normalizeAppContext(emptyCandidate("unsupported"));

    if (adapter.confidence < MIN_PROVIDER_CONFIDENCE) {
      return normalizeAppContext({
        fragments: [],
        metadata: {
          provider: adapter.provider,
          status: "suppressed",
          confidence: adapter.confidence,
          suppressionReason: "low_confidence_provider",
        },
      });
    }

    const text = uniqueBoundedLines([
      ...collectAccessibilityText(input.focusedElement),
      ...collectAccessibilityText(input.visibleRoot),
    ]);

    if (text.length === 0) {
      return normalizeAppContext({
        fragments: [],
        metadata: {
          provider: adapter.provider,
          status: "empty",
          confidence: adapter.confidence,
        },
      });
    }

    return normalizeAppContext({
      fragments: [
        {
          id: `${adapter.provider}:visible-context`,
          provider: adapter.provider,
          kind: adapter.kind,
          text,
          confidence: adapter.confidence,
        },
      ],
      metadata: {
        provider: adapter.provider,
        status: "available",
        confidence: adapter.confidence,
      },
    });
  };
}
