import type { ActiveApplication, AppContextFragment } from "@tabb/contracts";
import { sanitizeAppContextSnapshot, type AppContextSnapshot } from "./app-context.ts";

const PROVIDER = "whatsapp-conversation";
const WHATSAPP_BUNDLE_IDS = new Set([
  "net.whatsapp.WhatsApp",
  "net.whatsapp.WhatsAppDesktop",
  "desktop.WhatsApp",
]);
const DEFAULT_MAX_MESSAGES = 8;
const MAX_MESSAGE_TEXT_LENGTH = 500;
const LOW_CONFIDENCE_SUPPRESSION_REASON = "low_confidence_extraction";
const TIMESTAMP_PATTERN = /\b(?:[01]?\d|2[0-3]):[0-5]\d(?:\s?[AP]M)?\b/i;
const NOISY_TEXT = new Set([
  "archived chats",
  "new chat",
  "search",
  "settings",
  "whatsapp",
  "emoji",
  "voice message",
  "type a message",
]);

export type AccessibilityNode = {
  readonly role?: string;
  readonly subrole?: string;
  readonly title?: string;
  readonly value?: string;
  readonly description?: string;
  readonly label?: string;
  readonly identifier?: string;
  readonly children?: readonly AccessibilityNode[];
  readonly attributes?: Readonly<Record<string, unknown>>;
};

type MessageDirection = "incoming" | "outgoing" | "unknown";

type WhatsAppMessage = {
  readonly sender?: string;
  readonly direction: MessageDirection;
  readonly timestamp?: string;
  readonly text: string;
};

type WhatsAppMessageMetadata = Omit<WhatsAppMessage, "text">;

type ExtractWhatsAppConversationContextOptions = {
  readonly activeApplication: ActiveApplication | null;
  readonly accessibilityTree: AccessibilityNode | null | undefined;
  readonly maxMessages?: number;
};

function emptySnapshot(status: AppContextSnapshot["metadata"]["status"]): AppContextSnapshot {
  return { fragments: [], metadata: { provider: PROVIDER, status } };
}

function suppressedSnapshot(): AppContextSnapshot {
  return {
    fragments: [],
    metadata: {
      provider: PROVIDER,
      status: "suppressed",
      suppressionReason: LOW_CONFIDENCE_SUPPRESSION_REASON,
    },
  };
}

function isWhatsAppActive(activeApplication: ActiveApplication | null): boolean {
  if (!activeApplication) return false;
  if (WHATSAPP_BUNDLE_IDS.has(activeApplication.bundleId)) return true;
  return activeApplication.name?.toLowerCase() === "whatsapp";
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function nodeText(node: AccessibilityNode): string | undefined {
  return asString(node.description)
    ?? asString(node.value)
    ?? asString(node.title)
    ?? asString(node.label)
    ?? asString(node.attributes?.AXDescription)
    ?? asString(node.attributes?.AXValue)
    ?? asString(node.attributes?.AXTitle)
    ?? asString(node.attributes?.AXLabel);
}

function flattenTree(root: AccessibilityNode): AccessibilityNode[] {
  const nodes: AccessibilityNode[] = [];
  const stack: AccessibilityNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    nodes.push(node);
    if (node.children) stack.push(...node.children.slice().reverse());
  }
  return nodes;
}

function normalizeLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isHeadingNode(node: AccessibilityNode): boolean {
  const role = `${node.role ?? ""} ${node.subrole ?? ""}`.toLowerCase();
  const identifier = node.identifier?.toLowerCase() ?? "";
  return role.includes("heading") || identifier.includes("chat-title") || identifier.includes("conversation-title");
}

function extractChatTitle(nodes: readonly AccessibilityNode[]): string | undefined {
  for (const node of nodes) {
    if (!isHeadingNode(node)) continue;
    const text = nodeText(node);
    if (!text || NOISY_TEXT.has(text.toLowerCase())) continue;
    return normalizeLine(text).slice(0, 120);
  }
  return undefined;
}

function isMessageNode(node: AccessibilityNode, text: string): boolean {
  const role = `${node.role ?? ""} ${node.subrole ?? ""}`.toLowerCase();
  const identifier = node.identifier?.toLowerCase() ?? "";
  if (identifier.includes("message") || identifier.includes("bubble")) return true;
  if (role.includes("statictext") && TIMESTAMP_PATTERN.test(text)) return true;
  return false;
}

function removeTimestamp(text: string): { text: string; timestamp?: string } {
  const timestamp = text.match(TIMESTAMP_PATTERN)?.[0];
  if (!timestamp) return { text };
  return { text: normalizeLine(text.replace(TIMESTAMP_PATTERN, "")), timestamp };
}

function timestampFrom(text: string): string | undefined {
  return text.match(TIMESTAMP_PATTERN)?.[0];
}

function directionFromValue(value: unknown): MessageDirection {
  if (typeof value !== "string") return "unknown";
  const normalized = value.toLowerCase();
  if (normalized.includes("outgoing") || normalized.includes("sent")) return "outgoing";
  if (normalized.includes("incoming") || normalized.includes("received")) return "incoming";
  return "unknown";
}

function directionFromNode(node: AccessibilityNode): MessageDirection {
  for (const value of [
    node.attributes?.direction,
    node.attributes?.AXDirection,
    node.identifier,
    node.subrole,
    node.description,
  ]) {
    const direction = directionFromValue(value);
    if (direction !== "unknown") return direction;
  }
  return "unknown";
}

function parseMessageNode(node: AccessibilityNode): WhatsAppMessage | null {
  const rawText = nodeText(node);
  if (!rawText || !isMessageNode(node, rawText)) return null;

  const lines = rawText.split(/\r?\n/).map(normalizeLine).filter(Boolean);
  const compactText = normalizeLine(rawText);
  if (lines.length === 0 || NOISY_TEXT.has(compactText.toLowerCase())) return null;

  let sender: string | undefined;
  let direction = directionFromNode(node);
  let timestamp: string | undefined;
  let text = "";

  if (lines.length >= 3 && timestampFrom(lines[1] ?? "")) {
    sender = lines[0];
    timestamp = timestampFrom(lines[1] ?? "");
    text = lines.slice(2).join(" ");
  } else if (lines.length >= 2 && timestampFrom(lines[0] ?? "")) {
    timestamp = timestampFrom(lines[0] ?? "");
    text = lines.slice(1).join(" ");
  } else {
    const withoutTimestamp = removeTimestamp(compactText);
    timestamp = withoutTimestamp.timestamp;
    text = withoutTimestamp.text;
    const speakerMatch = text.match(/^([^:]{1,80}):\s+(.+)$/);
    if (speakerMatch) {
      sender = normalizeLine(speakerMatch[1] ?? "");
      text = normalizeLine(speakerMatch[2] ?? "");
    }
  }

  if (sender?.toLowerCase() === "you") direction = "outgoing";
  if (direction === "unknown" && sender) direction = "incoming";
  text = normalizeLine(text).slice(0, MAX_MESSAGE_TEXT_LENGTH);
  if (text.length < 2 || NOISY_TEXT.has(text.toLowerCase())) return null;

  return {
    ...(sender ? { sender } : {}),
    direction,
    ...(timestamp ? { timestamp } : {}),
    text,
  };
}

function dedupeMessages(messages: readonly WhatsAppMessage[]): WhatsAppMessage[] {
  const seen = new Set<string>();
  const deduped: WhatsAppMessage[] = [];
  for (const message of messages) {
    const key = `${message.sender ?? ""}:${message.direction}:${message.timestamp ?? ""}:${message.text}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(message);
  }
  return deduped;
}

function formatMessage(message: WhatsAppMessage): string {
  const sender = message.sender ? `${message.sender}: ` : "";
  return `[${message.direction}] ${sender}${message.text}`;
}

function messageMetadata(message: WhatsAppMessage): WhatsAppMessageMetadata {
  return {
    ...(message.sender ? { sender: message.sender } : {}),
    direction: message.direction,
    ...(message.timestamp ? { timestamp: message.timestamp } : {}),
  };
}

function confidenceFor(chatTitle: string | undefined, messages: readonly WhatsAppMessage[]): number {
  if (messages.length >= 2 && chatTitle) return 0.9;
  if (messages.length >= 2) return 0.8;
  if (messages.length === 1 && chatTitle) return 0.6;
  return 0;
}

export function extractWhatsAppConversationContext(
  options: ExtractWhatsAppConversationContextOptions,
): AppContextSnapshot {
  if (!isWhatsAppActive(options.activeApplication)) return emptySnapshot("unsupported");
  if (!options.accessibilityTree) return emptySnapshot("empty");

  const maxMessages = Math.max(1, options.maxMessages ?? DEFAULT_MAX_MESSAGES);
  const nodes = flattenTree(options.accessibilityTree);
  const chatTitle = extractChatTitle(nodes);
  const messages = dedupeMessages(
    nodes.map(parseMessageNode).filter((message): message is WhatsAppMessage => message !== null),
  ).slice(-maxMessages);
  const confidence = confidenceFor(chatTitle, messages);

  if (confidence < 0.65) return suppressedSnapshot();

  const text = [
    ...(chatTitle ? [`Chat: ${chatTitle}`] : []),
    ...messages.map(formatMessage),
  ].join("\n");
  const fragment: AppContextFragment = {
    id: `${PROVIDER}:visible-conversation`,
    provider: PROVIDER,
    kind: "conversation",
    text,
    confidence,
    metadata: {
      ...(chatTitle ? { chatTitle } : {}),
      messageCount: messages.length,
      messages: messages.map(messageMetadata),
    },
    redaction: { applied: false, redactionCount: 0, kinds: [] },
    requestable: true,
    memoryEligible: false,
  };

  return sanitizeAppContextSnapshot({
    fragments: [fragment],
    metadata: { provider: PROVIDER, status: "available", confidence },
  });
}
