import type { ActiveApplication, AppContext, AppContextFragment } from "@tabb/contracts";
import { redactSensitiveText } from "@tabb/redaction";

const MAX_FRAGMENTS = 5;
const MAX_FRAGMENT_LENGTH = 2_000;
const SECRET_LIKE_CONTEXT_SUPPRESSION_REASON = "secret_like_context";
const CHROME_WEB_PROVIDER = "chrome-web-writing-context";
const CHROME_BUNDLE_IDS = new Set([
  "com.google.Chrome",
  "com.google.Chrome.beta",
  "com.google.Chrome.canary",
  "com.google.Chrome.dev",
]);
const FOCUSED_EDITABLE_CONTEXT_LIMIT = 1_000;
const NEARBY_VISIBLE_CONTEXT_LIMIT = 1_500;
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

export type AppContextManager = {
  setSnapshot(snapshot: AppContextSnapshot): void;
  getSnapshot(): AppContextSnapshot;
  clear(): void;
};

function emptySnapshot(status: AppContextSnapshot["metadata"]["status"]): AppContextSnapshot {
  return { fragments: [], metadata: { status } };
}

function createSafeRedactionSummary(): AppContextFragment["redaction"] {
  return {
    applied: false,
    redactionCount: 0,
    kinds: [],
  };
}

function chromeWebUnavailableSnapshot(status: AppContextSnapshot["metadata"]["status"] = "unsupported"): AppContextSnapshot {
  return { fragments: [], metadata: { provider: CHROME_WEB_PROVIDER, status } };
}

function isChromeApplication(activeApplication: ActiveApplication | null | undefined): boolean {
  return activeApplication ? CHROME_BUNDLE_IDS.has(activeApplication.bundleId) : false;
}

function nodeRole(node: ChromeWebAccessibilityNode): string {
  return node.role ?? node.subrole ?? "";
}

function nodeText(node: ChromeWebAccessibilityNode): string {
  return [node.value, node.text, node.title, node.description]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.replace(/\s+/g, " ").trim())
    .find((value) => value.length > 0) ?? "";
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

function boundedText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength).replace(/\s+\S*$/, "").trim();
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

function collectNearbyVisibleText(
  node: ChromeWebAccessibilityNode,
  focused: ChromeWebAccessibilityNode,
  collected: string[],
): void {
  if (collected.length >= MAX_NEARBY_TEXT_NODES || !isVisibleNode(node) || isExcludedWebNode(node)) return;
  if (node === focused) return;

  const role = nodeRole(node);
  const text = nodeText(node);
  const hasChildren = (node.children?.length ?? 0) > 0;
  const canUseOwnText = !hasChildren || !AGGREGATE_TEXT_CONTAINER_ROLES.has(role);
  if (
    canUseOwnText &&
    text &&
    SEMANTIC_TEXT_ROLES.has(role) &&
    isNearbyNode(node, focused) &&
    !URL_LIKE_PATTERN.test(text)
  ) {
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
): AppContextFragment | null {
  const bounded = boundedText(text, MAX_FRAGMENT_LENGTH);
  if (!bounded) return null;

  return {
    id,
    provider: CHROME_WEB_PROVIDER,
    kind,
    text: bounded,
    confidence,
    redaction: createSafeRedactionSummary(),
    requestable: true,
    memoryEligible: false,
  };
}

function suppressedChromeWebSnapshot(reason = SECRET_LIKE_CONTEXT_SUPPRESSION_REASON): AppContextSnapshot {
  return {
    fragments: [],
    metadata: { provider: CHROME_WEB_PROVIDER, status: "suppressed", suppressionReason: reason },
  };
}

function containsSensitiveText(text: string): boolean {
  return redactSensitiveText(text).redactions.length > 0;
}

export function createChromeWebWritingContextSnapshot(input: {
  readonly activeApplication: ActiveApplication | null;
  readonly accessibilityTree: ChromeWebAccessibilityNode | null | undefined;
  readonly focusedElementId?: string;
}): AppContextSnapshot {
  if (!isChromeApplication(input.activeApplication)) return chromeWebUnavailableSnapshot();
  if (!input.accessibilityTree) return chromeWebUnavailableSnapshot("empty");

  const focused = findFocusedEditableNode(input.accessibilityTree, input.focusedElementId);
  if (!focused) return chromeWebUnavailableSnapshot("empty");

  const fragments: AppContextFragment[] = [];
  const focusedText = boundedText(nodeText(focused), FOCUSED_EDITABLE_CONTEXT_LIMIT);
  if (focusedText && containsSensitiveText(focusedText)) return suppressedChromeWebSnapshot();
  const focusedFragment = createChromeWebFragment("chrome-web-focused-editable", "focused_editable", focusedText, 0.92);
  if (focusedFragment) fragments.push(focusedFragment);

  const nearbyText: string[] = [];
  collectNearbyVisibleText(input.accessibilityTree, focused, nearbyText);
  if (nearbyText.some(containsSensitiveText)) return suppressedChromeWebSnapshot();
  const nearbyFragment = createChromeWebFragment(
    "chrome-web-nearby-visible-text",
    "nearby_visible_text",
    boundedText(nearbyText.join("\n"), NEARBY_VISIBLE_CONTEXT_LIMIT),
    nearbyText.length > 0 ? 0.82 : 0,
  );
  if (nearbyFragment) fragments.push(nearbyFragment);

  if (fragments.length === 0) return chromeWebUnavailableSnapshot("empty");

  return sanitizeAppContextSnapshot({
    fragments,
    metadata: {
      provider: CHROME_WEB_PROVIDER,
      status: "available",
      confidence: Math.max(...fragments.map((fragment) => fragment.confidence)),
    },
  });
}

function sanitizeFragment(fragment: AppContextFragment): AppContextFragment | null {
  if (!fragment.requestable || fragment.confidence <= 0) return null;

  const boundedText = fragment.text.slice(0, MAX_FRAGMENT_LENGTH);
  const redacted = redactSensitiveText(boundedText);
  if (redacted.redactions.length > 0 || redacted.text.trim().length === 0) {
    return null;
  }

  return {
    ...fragment,
    text: redacted.text,
    redaction: createSafeRedactionSummary(),
    memoryEligible: false,
  };
}

export function sanitizeAppContextSnapshot(snapshot: AppContextSnapshot): AppContextSnapshot {
  const fragments = snapshot.fragments
    .slice(0, MAX_FRAGMENTS)
    .map(sanitizeFragment)
    .filter((fragment): fragment is AppContextFragment => fragment !== null);

  if (snapshot.fragments.length > 0 && fragments.length === 0) {
    return {
      fragments: [],
      metadata: {
        provider: snapshot.metadata.provider,
        status: "suppressed",
        confidence: snapshot.metadata.confidence,
        suppressionReason: SECRET_LIKE_CONTEXT_SUPPRESSION_REASON,
      },
    };
  }

  if (fragments.length === 0) {
    return {
      fragments: [],
      metadata: {
        provider: snapshot.metadata.provider,
        status: snapshot.metadata.status === "cleared" ? "cleared" : "empty",
        confidence: snapshot.metadata.confidence,
      },
    };
  }

  return {
    fragments,
    metadata: {
      provider: snapshot.metadata.provider ?? fragments[0]?.provider,
      status: "available",
      confidence: snapshot.metadata.confidence ?? Math.max(...fragments.map((fragment) => fragment.confidence)),
    },
  };
}

export function createAppContextManager(): AppContextManager {
  let snapshot = emptySnapshot("empty");

  return {
    setSnapshot(nextSnapshot) {
      snapshot = sanitizeAppContextSnapshot(nextSnapshot);
    },
    getSnapshot() {
      return snapshot;
    },
    clear() {
      snapshot = emptySnapshot("cleared");
    },
  };
}
