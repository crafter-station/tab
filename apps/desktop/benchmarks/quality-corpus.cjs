const ELIGIBLE_SCENARIOS = [
  { channel: "message", app: "com.apple.MobileSMS", drafts: ["Can you send me", "Running a few minutes", "I left the keys"] },
  { channel: "message", app: "com.tinyspeck.slackmacgap", drafts: ["I reviewed the proposal and", "The deploy finished, but", "Let's move the sync to"] },
  { channel: "email", app: "com.apple.mail", drafts: ["Hi Maya,\n\nThanks for taking the time to", "I wanted to follow up on", "Would Thursday afternoon work"] },
  { channel: "email", app: "com.microsoft.Outlook", drafts: ["Hello team,\n\nThe customer confirmed that", "Before our next meeting, please", "I've attached the revised"] },
  { channel: "note", app: "com.apple.Notes", drafts: ["Groceries:\n- coffee\n- rice\n-", "Ideas for the weekend:\n", "Remember to call"] },
  { channel: "note", app: "notion.id", drafts: ["Decision: keep the first release", "Open questions:\n1. Who owns", "The main risk is"] },
  { channel: "document", app: "com.apple.TextEdit", drafts: ["The experiment showed a clear", "In the next section, we", "This approach works because"] },
  { channel: "document", app: "com.microsoft.Word", drafts: ["Executive summary\n\nThis quarter, the team", "The proposed migration will", "Our recommendation is to"] },
  { channel: "message", app: "com.apple.MobileSMS", drafts: ["¡Gracias por ayudarme con", "Nos vemos mañana a", "¿Puedes traer el"] },
  { channel: "message", app: "com.tinyspeck.slackmacgap", drafts: ["The café meeting is", "Renée said she would", "Ship the naïve fix only if"] },
  { channel: "email", app: "com.apple.mail", drafts: ["Quick update: the API", "After comparing both options,", "The next step is to"] },
  { channel: "email", app: "com.microsoft.Outlook", drafts: ["I can confirm that we", "Please let me know if", "For tomorrow's agenda, I added"] },
  { channel: "note", app: "com.apple.Notes", drafts: ["Book notes — chapter 4:\nThe author argues", "Workout plan:\nMonday —", "Packing list for Montréal:\n-"] },
  { channel: "note", app: "notion.id", drafts: ["Bug reproduction:\n1. Open settings\n2.", "Acceptance criteria:\n- Suggestions appear", "Research finding: users prefer"] },
  { channel: "document", app: "com.apple.TextEdit", drafts: ["Once the model is loaded,", "Although the first attempt failed,", "The results do not imply"] },
  { channel: "document", app: "com.microsoft.Word", drafts: ["Background\n\nAutocomplete systems must", "Privacy considerations include", "A successful rollout depends"] },
  { channel: "message", app: "com.apple.MobileSMS", drafts: ["I'll be there in about", "Happy birthday! Hope you", "Could we reschedule for"] },
  { channel: "message", app: "com.tinyspeck.slackmacgap", drafts: ["Small correction: the branch is", "No blocker from my side,", "I reproduced it when"] },
  { channel: "email", app: "com.apple.mail", drafts: ["Thanks again for your help. I", "To clarify my earlier note,", "The invoice should include"] },
  { channel: "document", app: "com.microsoft.Word", drafts: ["Conclusion\n\nTaken together, these findings", "Implementation should begin with", "We intentionally excluded"] },
];

const MEMORY_PROFILES = [
  [],
  ["The user's preferred name is Anthony."],
  ["The user prefers concise sentences.", "The user's team calls the product Tab."],
  ["The user works with Maya.", "The user prefers meetings after 2 PM.", "The user's project is named Tab."],
];

const NO_SUGGESTION_DRAFTS = [
  "asdf qwer zxcv",
  "... ... ...",
  "[[[{{{(((",
  "xqzv blrp nnn",
  "0000 //// ????",
  "Untitled",
  "Maybe",
  "Notes",
  "- - - - -",
  "q q q q q",
];

const SENSITIVE_DRAFTS = [
  "My password is ExampleOnly-NotARealPassword and the next character is",
  "The API key is sk-example-not-real-000000000000 and then",
  "My recovery code is EXAMPLE-ONLY-1234-5678 and",
  "The private key begins -----BEGIN EXAMPLE PRIVATE KEY-----",
  "My card number is 4111 1111 1111 1111 and the security code is",
  "The one-time login code is 123456 and it expires",
  "My social security number is 000-00-0000 and",
  "The database URL is postgres://example:fake@localhost/demo and",
  "The access token is example_token_not_valid_123 and",
  "The encryption secret is synthetic-not-a-secret and",
];

function buildQualityCases() {
  const eligible = [];
  for (const [scenarioIndex, scenario] of ELIGIBLE_SCENARIOS.entries()) {
    for (const [draftIndex, draft] of scenario.drafts.entries()) {
      for (const [memoryIndex, memories] of MEMORY_PROFILES.entries()) {
        eligible.push({
          index: eligible.length,
          kind: "eligible",
          channel: scenario.channel,
          activeApplication: scenario.app,
          contextSource: draftIndex === 1
            ? "recent-typing-with-nearby-text"
            : draftIndex === 2 ? "edited-recent-typing" : "recent-typing",
          draft,
          memories,
          appContext: draftIndex === 1
            ? Array.from({ length: [1, 2, 4, 8][memoryIndex] }, (_, contextIndex) =>
              `Synthetic nearby context ${scenarioIndex + 1}.${contextIndex + 1}: a related discussion is already in progress.`)
            : [],
          stratum: `${scenario.channel}/draft-${draftIndex + 1}/memory-${memoryIndex}`,
        });
      }
    }
  }

  const noSuggestion = Array.from({ length: 30 }, (_, offset) => ({
    index: eligible.length + offset,
    kind: "no-suggestion",
    channel: ["message", "note", "document"][offset % 3],
    activeApplication: ["com.apple.MobileSMS", "com.apple.Notes", "com.apple.TextEdit"][offset % 3],
    contextSource: "recent-typing",
    draft: NO_SUGGESTION_DRAFTS[offset % NO_SUGGESTION_DRAFTS.length],
    memories: [],
    appContext: [],
    stratum: `no-suggestion/${offset % NO_SUGGESTION_DRAFTS.length}`,
  }));

  const sensitive = Array.from({ length: 30 }, (_, offset) => ({
    index: eligible.length + noSuggestion.length + offset,
    kind: "sensitive",
    channel: ["message", "email", "note"][offset % 3],
    activeApplication: ["com.apple.MobileSMS", "com.apple.mail", "com.apple.Notes"][offset % 3],
    contextSource: "recent-typing",
    draft: SENSITIVE_DRAFTS[offset % SENSITIVE_DRAFTS.length],
    memories: [],
    appContext: [],
    stratum: `sensitive/${offset % SENSITIVE_DRAFTS.length}`,
  }));

  return [...eligible, ...noSuggestion, ...sensitive];
}

module.exports = { buildQualityCases };
