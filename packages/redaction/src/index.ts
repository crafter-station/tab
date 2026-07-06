export type RedactionResult = {
  text: string;
  redactions: readonly RedactionMatch[];
};

export type RedactionMatch = {
  kind: RedactionKind;
  replacement: string;
};

export type RedactionKind = "api_key" | "bearer_token" | "private_key" | "database_url";

const API_KEY_SECRET_PLACEHOLDER = "[REDACTED_SECRET]";

const REDACTION_RULES: readonly {
  kind: RedactionKind;
  pattern: RegExp;
  replacement: string;
}[] = [
  {
    kind: "private_key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: "[REDACTED_PRIVATE_KEY]",
  },
  {
    kind: "bearer_token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]+=*/g,
    replacement: "Bearer [REDACTED_TOKEN]",
  },
  {
    kind: "api_key",
    pattern: /\b(api[_-]?key|token|secret)\s*[=:]\s*['\"]?[A-Za-z0-9_./~+:-]{12,}['\"]?/gi,
    replacement: `$1=${API_KEY_SECRET_PLACEHOLDER}`,
  },
  {
    kind: "database_url",
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@]+:[^\s@]+@[^\s]+/gi,
    replacement: "[REDACTED_DATABASE_URL]",
  },
];

export function redactSensitiveText(input: string): RedactionResult {
  const redactions: RedactionMatch[] = [];
  let text = input;

  for (const rule of REDACTION_RULES) {
    text = text.replace(rule.pattern, (...replacementArgs: unknown[]) => {
      redactions.push({ kind: rule.kind, replacement: rule.replacement });

      if (rule.kind === "api_key") {
        const secretName = String(replacementArgs[1]);

        return `${secretName}=${API_KEY_SECRET_PLACEHOLDER}`;
      }

      return rule.replacement;
    });
  }

  return { text, redactions };
}
