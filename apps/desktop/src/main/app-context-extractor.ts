import type { ActiveApplication } from "@tab/contracts";
import { normalizeAppContext, type AppContextCandidate } from "./app-context-policy.ts";
import {
  createAppContextManager,
  createChromeWebWritingContextSnapshot,
  createGhosttyAppContextSnapshot,
  createObsidianDocumentAppContext,
  createZedFocusedEditorAppContextProvider,
  extractAppContextFromAccessibility,
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

type AccessibilityAppContextProvider = {
  readonly getSnapshot: (input: {
    readonly activeApplication: ActiveApplication | null;
    readonly accessibilityTree: AppContextAccessibilityTree | null | undefined;
  }) => AppContextCandidate;
};

type SnapshotProvider = {
  readonly getSnapshot: (snapshot: SafeTypingContextSnapshot) => AppContextCandidate;
};

function isAvailable(snapshot: AppContextCandidate): boolean {
  return snapshot.metadata.status === "available" && snapshot.fragments.length > 0;
}

function getAppContextFromTextSession(snapshot: SafeTypingContextSnapshot): AppContextCandidate {
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

function firstAvailableOrSuppressed(snapshots: readonly AppContextCandidate[]): AppContextCandidate | null {
  return snapshots.find((snapshot) => isAvailable(snapshot) || snapshot.metadata.status === "suppressed") ?? null;
}

function createAccessibilityProviderRegistry(): readonly AccessibilityAppContextProvider[] {
  return [
    {
      getSnapshot: ({ activeApplication, accessibilityTree }) =>
        createChromeWebWritingContextSnapshot({
          activeApplication,
          accessibilityTree: accessibilityTree as ChromeWebAccessibilityNode | null | undefined,
        }),
    },
    {
      getSnapshot: ({ activeApplication, accessibilityTree }) =>
        extractWhatsAppConversationContext({
          activeApplication,
          accessibilityTree: accessibilityTree as WhatsAppAccessibilityNode | null | undefined,
        }),
    },
    {
      getSnapshot: ({ activeApplication, accessibilityTree }) =>
        extractAppContextFromAccessibility(activeApplication, accessibilityTree as AccessibilityTextNode | null),
    },
  ];
}

function createSnapshotProviderRegistry(getZedAppContext: SnapshotAppContextProvider): readonly SnapshotProvider[] {
  return [
    {
      getSnapshot: (snapshot) =>
        snapshot.textSession ? createObsidianDocumentAppContext(snapshot.textSession) : { fragments: [], metadata: { status: "empty" } },
    },
    { getSnapshot: getZedAppContext },
    { getSnapshot: getAppContextFromTextSession },
    { getSnapshot: createGhosttyAppContextSnapshot },
  ];
}

export function createAppContextExtractor(options: {
  readonly zedProvider?: SnapshotAppContextProvider;
} = {}): AppContextExtractor {
  const managedContext = createAppContextManager();
  const getZedAppContext = options.zedProvider ?? createZedFocusedEditorAppContextProvider();
  const accessibilityProviders = createAccessibilityProviderRegistry();
  const snapshotProviders = createSnapshotProviderRegistry(getZedAppContext);

  return {
    ingestAccessibilityTree(input) {
      const snapshots = accessibilityProviders.map((provider) => provider.getSnapshot(input));
      managedContext.setSnapshot(firstAvailableOrSuppressed(snapshots) ?? { fragments: [], metadata: { status: "unsupported" } });
    },
    getSnapshot(snapshot) {
      const managedSnapshot = managedContext.getSnapshot();
      if (isAvailable(managedSnapshot)) return managedSnapshot;

      const snapshots = snapshotProviders.map((provider) => provider.getSnapshot(snapshot));
      return normalizeAppContext(
        firstAvailableOrSuppressed(snapshots)
          ?? snapshots[snapshots.length - 1]
          ?? { fragments: [], metadata: { status: "empty" } },
      );
    },
    clear() {
      managedContext.clear();
    },
  };
}
