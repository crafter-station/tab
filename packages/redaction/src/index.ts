export type RedactionResult = {
  text: string;
  redactions: readonly RedactionMatch[];
};

export type RedactionMatch = {
  kind: RedactionKind;
  replacement: string;
};

export type RedactionKind =
  | "api_key"
  | "stripe_key"
  | "bearer_token"
  | "private_key"
  | "database_url"
  | "env_variable"
  | "auth_header"
  | "cookie"
  | "payment_card"
  | "government_id"
  | "high_entropy_string";

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
    kind: "auth_header",
    pattern: /\b(Authorization|Auth)\s*[:=]\s*[^\r\n]{8,}/gi,
    replacement: "$1: [REDACTED_AUTH_HEADER]",
  },
  {
    kind: "cookie",
    pattern: /\b(Cookie|Set-Cookie)\s*:\s*[^\r\n]+/gi,
    replacement: "$1: [REDACTED_COOKIE]",
  },
  {
    kind: "env_variable",
    pattern: /\b(export\s+)?[A-Z_][A-Z0-9_]*\s*=\s*['"]?[A-Za-z0-9_./~+:-]{8,}['"]?/g,
    replacement: "[REDACTED_ENV_VAR]",
  },
  {
    kind: "api_key",
    pattern: /\b(api[_-]?key|token|secret)\s*[=:]\s*['"]?[A-Za-z0-9_./~+:-]{12,}['"]?/gi,
    replacement: `$1=${API_KEY_SECRET_PLACEHOLDER}`,
  },
  {
    kind: "stripe_key",
    pattern: /\b(sk|pk)_(live|test)_[A-Za-z0-9]{16,}\b/g,
    replacement: "[REDACTED_STRIPE_KEY]",
  },
  {
    kind: "bearer_token",
    pattern: /\beyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\b/g,
    replacement: "[REDACTED_JWT]",
  },
  {
    kind: "database_url",
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@]+:[^\s@]+@[^\s]+/gi,
    replacement: "[REDACTED_DATABASE_URL]",
  },
  {
    kind: "payment_card",
    pattern: /\b(?:\d[ -]*?){13,19}\b/g,
    replacement: "[REDACTED_PAYMENT_CARD]",
  },
  {
    kind: "government_id",
    pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
    replacement: "[REDACTED_GOVERNMENT_ID]",
  },
  {
    kind: "high_entropy_string",
    pattern: /\b(?:[A-Za-z0-9+/]{20,}={0,2}|[A-Fa-f0-9]{32,})\b/g,
    replacement: "[REDACTED_HIGH_ENTROPY_STRING]",
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

export type SensitiveDataSummary = {
  readonly hasSensitiveData: boolean;
  readonly kinds: readonly RedactionKind[];
};

export function detectSensitiveData(input: string): SensitiveDataSummary {
  const result = redactSensitiveText(input);
  const kinds = [...new Set(result.redactions.map((r) => r.kind))];
  return {
    hasSensitiveData: kinds.length > 0,
    kinds,
  };
}
