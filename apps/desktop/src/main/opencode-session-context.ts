import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { AppContextCandidate } from "./app-context-policy.ts";
import { isOpenCodeTerminal } from "./app-context.ts";
import type { SafeTypingContextSnapshot, TextSessionSnapshot } from "./typing-context.ts";

const execFileAsync = promisify(execFile);
const GHOSTTY_BUNDLE_ID = "com.mitchellh.ghostty";
const MAX_CONVERSATION_LENGTH = 600;
const REFRESH_INTERVAL_MS = 750;

export type OpenCodeContextRow = {
  session_id: string;
  title: string;
  directory: string;
  time_updated: number;
  message_id: string;
  message_time: number;
  role: string;
  text: string;
};

export type OpenCodeSession = {
  id: string;
  title: string;
  directory: string;
  updatedAt: number;
  messages: Array<{ id: string; time: number; role: string; text: string }>;
};

export type OpenCodeConversationContext = {
  observe(snapshot: TextSessionSnapshot): Promise<void>;
  getCandidate(snapshot: SafeTypingContextSnapshot): AppContextCandidate;
  clear(): void;
};

export type OpenCodeConversationContextOptions = {
  readonly dataDirectory: string;
  readonly databasePaths?: readonly string[];
  readonly queryDatabase?: (databasePath: string) => Promise<OpenCodeContextRow[]>;
  readonly now?: () => number;
};

const SESSION_CONTEXT_QUERY = `
WITH recent_sessions AS (
  SELECT id, title, directory, time_updated
  FROM session
  WHERE parent_id IS NULL AND time_archived IS NULL
  ORDER BY time_updated DESC
  LIMIT 40
)
SELECT
  s.id AS session_id,
  s.title,
  s.directory,
  s.time_updated,
  m.id AS message_id,
  m.time_created AS message_time,
  json_extract(m.data, '$.role') AS role,
  substr(json_extract(p.data, '$.text'), 1, 2000) AS text
FROM recent_sessions s
JOIN message m ON m.session_id = s.id
JOIN part p ON p.message_id = m.id
WHERE json_extract(p.data, '$.type') = 'text'
  AND json_extract(p.data, '$.text') IS NOT NULL
ORDER BY s.time_updated DESC, m.time_created DESC, p.time_created DESC
LIMIT 400
`;

async function queryOpenCodeDatabase(databasePath: string): Promise<OpenCodeContextRow[]> {
  const { stdout } = await execFileAsync("/usr/bin/sqlite3", ["-readonly", "-json", databasePath, SESSION_CONTEXT_QUERY], {
    maxBuffer: 2 * 1024 * 1024,
    timeout: 500,
  });
  if (!stdout.trim()) return [];
  const rows = JSON.parse(stdout) as unknown;
  return Array.isArray(rows) ? rows.filter(isOpenCodeContextRow) : [];
}

function isOpenCodeContextRow(value: unknown): value is OpenCodeContextRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<OpenCodeContextRow>;
  return typeof row.session_id === "string"
    && typeof row.title === "string"
    && typeof row.directory === "string"
    && typeof row.time_updated === "number"
    && typeof row.message_id === "string"
    && typeof row.message_time === "number"
    && typeof row.role === "string"
    && typeof row.text === "string";
}

function databasePaths(dataDirectory: string): string[] {
  if (!existsSync(dataDirectory)) return [];
  try {
    return readdirSync(dataDirectory)
      .filter((name) => /^opencode(?:-[a-z0-9_-]+)?\.db$/i.test(name))
      .map((name) => path.join(dataDirectory, name));
  } catch {
    return [];
  }
}

function sessionsFromRows(rows: readonly OpenCodeContextRow[]): OpenCodeSession[] {
  const sessions = new Map<string, OpenCodeSession>();
  for (const row of rows) {
    const session = sessions.get(row.session_id) ?? {
      id: row.session_id,
      title: row.title,
      directory: row.directory,
      updatedAt: row.time_updated,
      messages: [],
    };
    if (!session.messages.some((message) => message.id === row.message_id && message.text === row.text)) {
      session.messages.push({ id: row.message_id, time: row.message_time, role: row.role, text: row.text });
    }
    sessions.set(row.session_id, session);
  }
  for (const session of sessions.values()) {
    session.messages.sort((a, b) => a.time - b.time);
  }
  return [...sessions.values()];
}

function renderedSessionTitle(title: string): string {
  if (/^(New|Child) session - \d{4}-\d{2}-\d{2}T/.test(title)) return "OpenCode";
  return `OC | ${title.length > 40 ? `${title.slice(0, 37)}...` : title}`;
}

function normalizedText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function transcriptMatchCount(session: OpenCodeSession, terminalContents: string): number {
  const visible = normalizedText(terminalContents);
  const matches = new Set<string>();
  for (const message of session.messages) {
    const text = normalizedText(message.text);
    if (text.length < 32) continue;
    const excerpt = text.slice(0, Math.min(120, text.length));
    if (visible.includes(excerpt)) matches.add(message.id);
  }
  return matches.size;
}

export function matchOpenCodeSession(
  sessions: readonly OpenCodeSession[],
  terminalTitle: string | undefined,
  terminalContents: string,
): OpenCodeSession | null {
  const titleMatches = terminalTitle
    ? sessions.filter((session) => renderedSessionTitle(session.title) === terminalTitle)
    : [];
  if (terminalTitle && terminalTitle !== "OpenCode" && titleMatches.length === 1) {
    return titleMatches[0] ?? null;
  }

  const candidates = titleMatches.length > 0 ? titleMatches : sessions;
  const transcriptMatches = candidates
    .map((session) => ({ session, matches: transcriptMatchCount(session, terminalContents) }))
    .filter((candidate) => candidate.matches > 0)
    .sort((a, b) => b.matches - a.matches);
  if (transcriptMatches.length === 0) return null;
  const best = transcriptMatches[0];
  const runnerUp = transcriptMatches[1];
  if (!best || best.matches < 2 || best.matches === runnerUp?.matches) return null;
  return best.session;
}

function conversationText(session: OpenCodeSession): string {
  return session.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-4)
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.text.trim()}`)
    .join("\n\n")
    .slice(-MAX_CONVERSATION_LENGTH);
}

function emptyCandidate(status: "empty" | "unsupported" = "empty"): AppContextCandidate {
  return { fragments: [], metadata: { provider: "opencode-local-session", status, confidence: 0 } };
}

export function createOpenCodeConversationContext(
  options: OpenCodeConversationContextOptions,
): OpenCodeConversationContext {
  const queryDatabase = options.queryDatabase ?? queryOpenCodeDatabase;
  const now = options.now ?? Date.now;
  let candidate: AppContextCandidate = emptyCandidate();
  let targetKey: string | null = null;
  let lastRefreshAt = 0;
  let inFlightGeneration: number | null = null;
  let generation = 0;

  return {
    async observe(snapshot) {
      const title = snapshot.terminalTitle;
      const contents = snapshot.terminalContents ?? "";
      const nextTargetKey = `${snapshot.activeApplication?.windowId ?? "window-unknown"}:${title ?? "title-unknown"}`;
      if (snapshot.activeApplication?.bundleId !== GHOSTTY_BUNDLE_ID || !isOpenCodeTerminal(title, contents)) {
        generation += 1;
        targetKey = null;
        candidate = emptyCandidate("unsupported");
        return;
      }
      if (inFlightGeneration !== null || (targetKey === nextTargetKey && now() - lastRefreshAt < REFRESH_INTERVAL_MS)) return;

      lastRefreshAt = now();
      const requestGeneration = ++generation;
      inFlightGeneration = requestGeneration;
      try {
        const rows = (await Promise.all(
          (options.databasePaths ?? databasePaths(options.dataDirectory))
            .map((databasePath) => queryDatabase(databasePath).catch(() => [])),
        )).flat();
        const session = matchOpenCodeSession(sessionsFromRows(rows), title, contents);
        if (requestGeneration !== generation) return;
        targetKey = nextTargetKey;
        if (!session) {
          candidate = emptyCandidate();
          return;
        }
        const text = conversationText(session);
        candidate = text
          ? {
              fragments: [{
                id: "opencode-conversation",
                provider: "opencode-local-session",
                kind: "conversation",
                text,
                confidence: 0.95,
                requestPayloadPolicy: { maxLength: MAX_CONVERSATION_LENGTH, preserveWholeWords: true, from: "end" },
              }],
              metadata: { provider: "opencode-local-session", status: "available", confidence: 0.95 },
            }
          : emptyCandidate();
      } finally {
        if (inFlightGeneration === requestGeneration) inFlightGeneration = null;
      }
    },
    getCandidate(snapshot) {
      const key = `${snapshot.activeApplication?.windowId ?? "window-unknown"}:${snapshot.textSession?.terminalTitle ?? "title-unknown"}`;
      return key === targetKey ? candidate : emptyCandidate();
    },
    clear() {
      generation += 1;
      inFlightGeneration = null;
      targetKey = null;
      candidate = emptyCandidate();
    },
  };
}
