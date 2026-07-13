import type { ActiveApplication } from "@tab/contracts";
import { normalizeAppContext, type AppContextCandidate } from "./app-context-policy.ts";
import {
  createAppContextManager,
  createChromeWebWritingContextCandidate,
  createGhosttyAppContextCandidate,
  createObsidianDocumentAppContextCandidate,
  createZedFocusedEditorAppContextCandidateProvider,
  extractAppContextCandidateFromAccessibility,
  type AccessibilityTextNode,
  type AppContextCandidateProvider,
  type AppContextSnapshot,
  type ChromeWebAccessibilityNode,
} from "./app-context.ts";
import { extractWhatsAppConversationContextCandidate } from "./whatsapp-app-context.ts";
import type { AccessibilityNode as WhatsAppAccessibilityNode } from "./whatsapp-app-context.ts";
import type { SafeTypingContextSnapshot, TextSessionSnapshot } from "./typing-context.ts";
import type { OpenCodeConversationContext } from "./opencode-session-context.ts";

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
  ingestTextSession?(snapshot: TextSessionSnapshot): void;
  clear(): void;
};

type AccessibilityAppContextCandidateProvider = {
  readonly getCandidate: (input: {
    readonly activeApplication: ActiveApplication | null;
    readonly accessibilityTree: AppContextAccessibilityTree | null | undefined;
  }) => AppContextCandidate;
};

type SnapshotCandidateProvider = {
  readonly getCandidate: (snapshot: SafeTypingContextSnapshot) => AppContextCandidate;
};

function isAvailable(snapshot: AppContextCandidate): boolean {
  return snapshot.metadata.status === "available" && snapshot.fragments.length > 0;
}

function getAppContextCandidateFromTextSession(snapshot: SafeTypingContextSnapshot): AppContextCandidate {
  const surroundingContext = snapshot.textSession?.surroundingContext;
  if (!surroundingContext) return { fragments: [], metadata: { status: "empty" } };

  const children: AccessibilityTextNode[] = [];
  for (const value of [surroundingContext.beforeCaret, surroundingContext.afterCaret]) {
    const trimmedValue = value?.trim();
    if (trimmedValue) children.push({ role: "AXStaticText", value: trimmedValue });
  }

  return extractAppContextCandidateFromAccessibility(snapshot.activeApplication, {
    role: "AXFocusedTextSession",
    children,
  });
}

function firstAvailableOrSuppressed(snapshots: readonly AppContextCandidate[]): AppContextCandidate | null {
  return snapshots.find((snapshot) => isAvailable(snapshot) || snapshot.metadata.status === "suppressed") ?? null;
}

function createAccessibilityCandidateProviderRegistry(): readonly AccessibilityAppContextCandidateProvider[] {
  return [
    {
      getCandidate: ({ activeApplication, accessibilityTree }) =>
        createChromeWebWritingContextCandidate({
          activeApplication,
          accessibilityTree: accessibilityTree as ChromeWebAccessibilityNode | null | undefined,
        }),
    },
    {
      getCandidate: ({ activeApplication, accessibilityTree }) =>
        extractWhatsAppConversationContextCandidate({
          activeApplication,
          accessibilityTree: accessibilityTree as WhatsAppAccessibilityNode | null | undefined,
        }),
    },
    {
      getCandidate: ({ activeApplication, accessibilityTree }) =>
        extractAppContextCandidateFromAccessibility(activeApplication, accessibilityTree as AccessibilityTextNode | null),
    },
  ];
}

function combineCandidates(primary: AppContextCandidate, fallback: AppContextCandidate): AppContextCandidate {
  if (!isAvailable(primary)) return fallback;
  if (!isAvailable(fallback)) return primary;
  return {
    fragments: [...primary.fragments, ...fallback.fragments],
    metadata: primary.metadata,
  };
}

function createSnapshotCandidateProviderRegistry(
  getZedAppContext: AppContextCandidateProvider,
  openCodeConversation?: OpenCodeConversationContext,
): readonly SnapshotCandidateProvider[] {
  return [
    {
      getCandidate: (snapshot) =>
        snapshot.textSession ? createObsidianDocumentAppContextCandidate(snapshot.textSession) : { fragments: [], metadata: { status: "empty" } },
    },
    { getCandidate: getZedAppContext },
    {
      getCandidate: (snapshot) => combineCandidates(
        openCodeConversation?.getCandidate(snapshot) ?? { fragments: [], metadata: { status: "empty" } },
        createGhosttyAppContextCandidate(snapshot),
      ),
    },
    { getCandidate: getAppContextCandidateFromTextSession },
  ];
}

export function createAppContextExtractor(options: {
  readonly zedCandidateProvider?: AppContextCandidateProvider;
  readonly openCodeConversation?: OpenCodeConversationContext;
} = {}): AppContextExtractor {
  const managedContext = createAppContextManager();
  const getZedAppContext = options.zedCandidateProvider ?? createZedFocusedEditorAppContextCandidateProvider();
  const accessibilityProviders = createAccessibilityCandidateProviderRegistry();
  const snapshotProviders = createSnapshotCandidateProviderRegistry(getZedAppContext, options.openCodeConversation);

  return {
    ingestAccessibilityTree(input) {
      const candidates = accessibilityProviders.map((provider) => provider.getCandidate(input));
      managedContext.setCandidate(firstAvailableOrSuppressed(candidates) ?? { fragments: [], metadata: { status: "unsupported" } });
    },
    getSnapshot(snapshot) {
      const managedSnapshot = managedContext.getSnapshot();
      if (isAvailable(managedSnapshot) || managedSnapshot.metadata.status === "suppressed") {
        return managedSnapshot;
      }

      const candidates = snapshotProviders.map((provider) => provider.getCandidate(snapshot));
      return normalizeAppContext(
        firstAvailableOrSuppressed(candidates)
          ?? candidates[candidates.length - 1]
          ?? { fragments: [], metadata: { status: "empty" } },
      );
    },
    ingestTextSession(snapshot) {
      void options.openCodeConversation?.observe(snapshot);
    },
    clear() {
      managedContext.clear();
      options.openCodeConversation?.clear();
    },
  };
}
