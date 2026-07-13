import { describe, expect, it } from "bun:test";
import {
  createOpenCodeConversationContext,
  matchOpenCodeSession,
  type OpenCodeContextRow,
  type OpenCodeSession,
} from "../apps/desktop/src/main/opencode-session-context.ts";
import { createSafeTypingContextSnapshot, type TextSessionSnapshot } from "../apps/desktop/src/main/typing-context.ts";

function session(id: string, title: string, messages: string[]): OpenCodeSession {
  return {
    id,
    title,
    directory: "/repo",
    updatedAt: 1,
    messages: messages.map((text, index) => ({
      id: `${id}-message-${index}`,
      time: index,
      role: index % 2 === 0 ? "user" : "assistant",
      text,
    })),
  };
}

function terminalSnapshot(title = "OC | Fix terminal autocomplete"): TextSessionSnapshot {
  return {
    activeApplication: { bundleId: "com.mitchellh.ghostty", windowId: "window:1" },
    focusedElementId: "ghostty:text-area",
    textElementId: "ghostty:text-area",
    selectedRange: { location: 0, length: 0 },
    caretIdentity: "range:0:0",
    secureLike: false,
    accessibilityReliability: "reliable",
    terminalTitle: title,
    terminalContents: "┃ Draft\n▣ Build · model · 2s\n╹",
  };
}

describe("OpenCode local session context", () => {
  it("matches a unique rendered session title", () => {
    const target = session("session-1", "Fix terminal autocomplete", ["First message"]);
    const other = session("session-2", "Another task", ["Other message"]);

    expect(matchOpenCodeSession([target, other], "OC | Fix terminal autocomplete", "")).toEqual(target);
  });

  it("requires multiple unique transcript matches when titles are ambiguous", () => {
    const firstMessage = "Explain why terminal draft reconstruction needs confidence states.";
    const secondMessage = "Use submitted conversation only as background for suggestions.";
    const target = session("session-1", "New session - 2026-07-12T00:00:00.000Z", [firstMessage, secondMessage]);
    const other = session("session-2", "New session - 2026-07-12T00:01:00.000Z", [firstMessage, "A different response that is not visible."]);

    expect(matchOpenCodeSession(
      [target, other],
      "OpenCode",
      `${firstMessage}\n${secondMessage}`,
    )).toEqual(target);
    expect(matchOpenCodeSession([target, other], "OpenCode", firstMessage)).toBeNull();
  });

  it("loads bounded conversation context from a matched local database", async () => {
    const rows: OpenCodeContextRow[] = [
      {
        session_id: "session-1",
        title: "Fix terminal autocomplete",
        directory: "/repo",
        time_updated: 2,
        message_id: "message-1",
        message_time: 1,
        role: "user",
        text: "Please make terminal suggestions context aware.",
      },
      {
        session_id: "session-1",
        title: "Fix terminal autocomplete",
        directory: "/repo",
        time_updated: 2,
        message_id: "message-2",
        message_time: 2,
        role: "assistant",
        text: "I will use the local session database as read-only background.",
      },
    ];
    const context = createOpenCodeConversationContext({
      dataDirectory: "/missing",
      databasePaths: ["opencode.db"],
      queryDatabase: async () => rows,
    });
    const textSession = terminalSnapshot();

    await context.observe(textSession);
    const snapshot = {
      ...createSafeTypingContextSnapshot({
        context: "Continue this",
        activeApplication: textSession.activeApplication,
        secureInput: false,
        paused: false,
        privateContext: false,
        contextSource: "terminal_input",
        memoryEligible: true,
      }),
      textSession,
    };
    const candidate = context.getCandidate(snapshot);

    expect(candidate.metadata).toMatchObject({ provider: "opencode-local-session", status: "available" });
    expect(candidate.fragments[0]).toMatchObject({
      provider: "opencode-local-session",
      kind: "conversation",
    });
    expect(candidate.fragments[0]?.metadata).toBeUndefined();
    expect(candidate.fragments[0]?.text).toContain("User: Please make terminal suggestions context aware.");
    expect(candidate.fragments[0]?.text).toContain("Assistant: I will use the local session database");
  });
});
