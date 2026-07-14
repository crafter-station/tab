import { describe, expect, it } from "bun:test";
import {
  createOpenCodeConversationContext,
  matchOpenCodeSession,
  type OpenCodeContextRow,
  type OpenCodeSession,
} from "../apps/desktop/src/main/opencode-session-context.ts";
import { createSafeTypingContextSnapshot, type TextSessionSnapshot } from "../apps/desktop/src/main/typing-context.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

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

  it("reuses cached database rows while the database revision is unchanged", async () => {
    let now = 1_000;
    let queryCount = 0;
    const context = createOpenCodeConversationContext({
      dataDirectory: "/missing",
      databasePaths: ["opencode.db"],
      databaseRevision: () => "revision-1",
      now: () => now,
      queryDatabase: async () => {
        queryCount += 1;
        return [];
      },
    });
    const snapshot = terminalSnapshot();

    await context.observe(snapshot);
    now += 751;
    await context.observe(snapshot);

    expect(queryCount).toBe(1);
  });

  it("publishes only the newest observation when the target changes during a query", async () => {
    const firstQuery = deferred<OpenCodeContextRow[]>();
    const secondQuery = deferred<OpenCodeContextRow[]>();
    let queryCount = 0;
    let databaseRevision = "revision-1";
    const context = createOpenCodeConversationContext({
      dataDirectory: "/missing",
      databasePaths: ["opencode.db"],
      databaseRevision: () => databaseRevision,
      queryDatabase: () => (++queryCount === 1 ? firstQuery.promise : secondQuery.promise),
    });
    const firstSnapshot = terminalSnapshot("OC | First session");
    const secondSnapshot = terminalSnapshot("OC | Second session");
    const firstObservation = context.observe(firstSnapshot);

    databaseRevision = "revision-2";
    void context.observe(secondSnapshot);
    expect(context.getState(secondSnapshot)).toMatchObject({ pending: true, candidate: { fragments: [] } });

    firstQuery.resolve([{
      session_id: "session-1",
      title: "First session",
      directory: "/repo",
      time_updated: 1,
      message_id: "message-1",
      message_time: 1,
      role: "user",
      text: "First session context that must never be published for the second target.",
    }]);
    while (queryCount < 2) await Promise.resolve();
    secondQuery.resolve([{
      session_id: "session-2",
      title: "Second session",
      directory: "/repo",
      time_updated: 2,
      message_id: "message-2",
      message_time: 2,
      role: "assistant",
      text: "Second session context is the only valid result for this target.",
    }]);
    await firstObservation;

    expect(context.getState(secondSnapshot).candidate.fragments[0]?.text).toContain("Second session context");
    expect(context.getState(firstSnapshot).candidate.fragments).toEqual([]);
  });

  it("invalidates same-window generic-title context before rematching changed terminal evidence", async () => {
    const firstMessage = "First unique conversation excerpt long enough for matching session one.";
    const secondMessage = "Second unique conversation excerpt confirms matching session one.";
    const nextQuery = deferred<OpenCodeContextRow[]>();
    let queryCount = 0;
    let databaseRevision = "revision-1";
    const rows: OpenCodeContextRow[] = [firstMessage, secondMessage].map((text, index) => ({
      session_id: "session-1",
      title: "New session - 2026-07-12T00:00:00.000Z",
      directory: "/repo",
      time_updated: 1,
      message_id: `message-${index}`,
      message_time: index,
      role: index === 0 ? "user" : "assistant",
      text,
    }));
    const context = createOpenCodeConversationContext({
      dataDirectory: "/missing",
      databasePaths: ["opencode.db"],
      databaseRevision: () => databaseRevision,
      queryDatabase: () => (++queryCount === 1 ? Promise.resolve(rows) : nextQuery.promise),
    });
    const firstSnapshot = {
      ...terminalSnapshot("OpenCode"),
      terminalContents: `${firstMessage}\n${secondMessage}`,
    };
    await context.observe(firstSnapshot);
    expect(context.getState(firstSnapshot).candidate.metadata.status).toBe("available");

    const secondSnapshot = {
      ...terminalSnapshot("OpenCode"),
      terminalContents: "┃ A different new session\n▣ Build · model · 1s\n╹",
    };
    databaseRevision = "revision-2";
    const observation = context.observe(secondSnapshot);

    expect(context.getState(secondSnapshot)).toMatchObject({ pending: true, candidate: { fragments: [] } });
    nextQuery.resolve([]);
    await observation;
  });

  it("notifies subscribers when effective context becomes pending and ready", async () => {
    const query = deferred<OpenCodeContextRow[]>();
    const context = createOpenCodeConversationContext({
      dataDirectory: "/missing",
      databasePaths: ["opencode.db"],
      queryDatabase: () => query.promise,
    });
    const revisions: number[] = [];
    context.subscribe((state) => revisions.push(state.revision));
    const observation = context.observe(terminalSnapshot());

    expect(revisions).toHaveLength(1);
    query.resolve([{
      session_id: "session-1",
      title: "Fix terminal autocomplete",
      directory: "/repo",
      time_updated: 1,
      message_id: "message-1",
      message_time: 1,
      role: "user",
      text: "Context publication should notify the active native suggestion session.",
    }]);
    await observation;

    expect(revisions).toHaveLength(2);
    expect(revisions[1]).toBeGreaterThan(revisions[0] ?? 0);
  });

  it("does not publish an in-flight result after clearing", async () => {
    const query = deferred<OpenCodeContextRow[]>();
    const context = createOpenCodeConversationContext({
      dataDirectory: "/missing",
      databasePaths: ["opencode.db"],
      queryDatabase: () => query.promise,
    });
    const snapshot = terminalSnapshot();
    const observation = context.observe(snapshot);

    context.clear();
    query.resolve([{
      session_id: "session-1",
      title: "Fix terminal autocomplete",
      directory: "/repo",
      time_updated: 1,
      message_id: "message-1",
      message_time: 1,
      role: "user",
      text: "This stale result must not be published after clear.",
    }]);
    await observation;

    expect(context.getState(snapshot)).toMatchObject({ pending: false, candidate: { fragments: [] } });
  });

  it("settles to empty context when every database query fails", async () => {
    const context = createOpenCodeConversationContext({
      dataDirectory: "/missing",
      databasePaths: ["opencode.db"],
      queryDatabase: async () => {
        throw new Error("database unavailable");
      },
    });
    const snapshot = terminalSnapshot();

    await context.observe(snapshot);

    expect(context.getState(snapshot)).toMatchObject({
      pending: false,
      candidate: { fragments: [], metadata: { status: "empty" } },
    });
  });
});
