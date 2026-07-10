export type SuggestionEvalCase = {
  readonly id: string;
  readonly draft: string;
  readonly app: string;
  readonly intent: string;
};

export const SUGGESTION_EVAL_CASES: readonly SuggestionEvalCase[] = [
  { id: "greeting", draft: "Hello, ", app: "com.apple.MobileSMS", intent: "Continue a friendly greeting naturally." },
  { id: "thanks", draft: "Thank you for", app: "com.apple.mail", intent: "Complete a concise expression of thanks." },
  { id: "follow-up", draft: "I wanted to", app: "com.apple.mail", intent: "Continue a common email sentence without inventing specifics." },
  { id: "partial-word", draft: "See you tom", app: "com.apple.MobileSMS", intent: "Complete the partial word without inserting a space." },
  { id: "meeting", draft: "Can we meet", app: "com.tinyspeck.slackmacgap", intent: "Continue a meeting question naturally." },
  { id: "status", draft: "The deployment is", app: "com.tinyspeck.slackmacgap", intent: "Continue a neutral status update without unsupported details." },
  { id: "birthday", draft: "Happy birthday! Hope you", app: "com.apple.MobileSMS", intent: "Continue a warm birthday message." },
  { id: "request", draft: "Please let me know", app: "com.apple.mail", intent: "Continue a polite request naturally." },
  { id: "document", draft: "This approach works because", app: "com.apple.TextEdit", intent: "Continue explanatory prose without chat framing." },
  { id: "list", draft: "Groceries:\n- coffee\n- rice\n-", app: "com.apple.Notes", intent: "Suggest a plausible short grocery-list item." },
  { id: "spanish", draft: "Nos vemos mañana a", app: "com.apple.MobileSMS", intent: "Continue naturally in Spanish." },
  { id: "accented", draft: "The café meeting is", app: "com.tinyspeck.slackmacgap", intent: "Continue naturally while preserving the language and tone." },
];
