import type { ActiveApplication } from "@tab/contracts";
import {
  createAppContextManager,
  createChromeWebWritingContextSnapshot,
  createGhosttyAppContextSnapshot,
  createObsidianDocumentAppContext,
  createZedFocusedEditorAppContextProvider,
  extractAppContextFromAccessibility,
  sanitizeAppContextSnapshot,
  type AccessibilityTextNode,
  type AppContextSnapshot,
  type ChromeWebAccessibilityNode,
  type SnapshotAppContextProvider,
} from "./app-context.ts";
import { extractWhatsAppConversationContext } from "./whatsapp-app-context.ts";
import type { AccessibilityNode as WhatsAppAccessibilityNode } from "./whatsapp-app-context.ts";
import type { SafeTypingContextSnapshot } from "./typing-context.ts";

export type AppContextAccessibilityTree = {
  readonly id?: string;
  readonly role?: string;
  readonly subrole?: string;
  readonly title?: string;
  readonly value?: string;
  readonly description?: string;
  readonly label?: string;
  readonly text?: string;
  readonly placeholder?: string;
  readonly identifier?: string;
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
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly children?: readonly AppContextAccessibilityTree[];
};

export type AppContextExtractor = {
  ingestAccessibilityTree(input: {
    readonly activeApplication: ActiveApplication | null;
    readonly accessibilityTree: AppContextAccessibilityTree | null | undefined;
  }): void;
  getSnapshot(snapshot: SafeTypingContextSnapshot): AppContextSnapshot;
  clear(): void;
};

function isAvailable(snapshot: AppContextSnapshot): boolean {
  return snapshot.metadata.status === "available" && snapshot.fragments.length > 0;
}

function getAppContextFromTextSession(snapshot: SafeTypingContextSnapshot): AppContextSnapshot {
  const surroundingContext = snapshot.textSession?.surroundingContext;
  if (!surroundingContext) return { fragments: [], metadata: { status: "empty" } };

  const children: AccessibilityTextNode[] = [];
  for (const value of [surroundingContext.beforeCaret, surroundingContext.afterCaret]) {
    const trimmedValue = value?.trim();
    if (trimmedValue) children.push({ role: "AXStaticText", value: trimmedValue });
  }

  return extractAppContextFromAccessibility(snapshot.activeApplication, {
    role: "AXFocusedTextSession",
    children,
  });
}

function extractFromAccessibilityTree(
  activeApplication: ActiveApplication | null,
  accessibilityTree: AppContextAccessibilityTree | null | undefined,
): AppContextSnapshot {
  const chromeContext = createChromeWebWritingContextSnapshot({
    activeApplication,
    accessibilityTree: accessibilityTree as ChromeWebAccessibilityNode | null | undefined,
  });
  if (isAvailable(chromeContext) || chromeContext.metadata.status === "suppressed") return chromeContext;

  const whatsAppContext = extractWhatsAppConversationContext({
    activeApplication,
    accessibilityTree: accessibilityTree as WhatsAppAccessibilityNode | null | undefined,
  });
  if (isAvailable(whatsAppContext) || whatsAppContext.metadata.status === "suppressed") return whatsAppContext;

  return extractAppContextFromAccessibility(activeApplication, accessibilityTree as AccessibilityTextNode | null);
}

export function createAppContextExtractor(options: {
  readonly zedProvider?: SnapshotAppContextProvider;
} = {}): AppContextExtractor {
  const managedContext = createAppContextManager();
  const getZedAppContext = options.zedProvider ?? createZedFocusedEditorAppContextProvider();

  return {
    ingestAccessibilityTree(input) {
      managedContext.setSnapshot(extractFromAccessibilityTree(input.activeApplication, input.accessibilityTree));
    },
    getSnapshot(snapshot) {
      const managedSnapshot = managedContext.getSnapshot();
      if (isAvailable(managedSnapshot)) return managedSnapshot;

      if (snapshot.textSession) {
        const obsidianContext = createObsidianDocumentAppContext(snapshot.textSession);
        if (isAvailable(obsidianContext)) return obsidianContext;
      }

      const zedContext = getZedAppContext(snapshot);
      if (isAvailable(zedContext)) return zedContext;

      const textSessionContext = getAppContextFromTextSession(snapshot);
      if (isAvailable(textSessionContext)) return textSessionContext;

      return sanitizeAppContextSnapshot(createGhosttyAppContextSnapshot(snapshot));
    },
    clear() {
      managedContext.clear();
    },
  };
}
