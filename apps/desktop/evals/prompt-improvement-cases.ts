export type PromptImprovementCase = {
  readonly id: string;
  readonly category: string;
  readonly surface: string;
  readonly app: string;
  readonly draft: string;
  readonly intent: string;
  readonly background?: string;
};

type CaseSeed = readonly [draft: string, intent: string, background?: string];

function group(
  category: string,
  surface: string,
  app: string,
  seeds: readonly CaseSeed[],
): PromptImprovementCase[] {
  return seeds.map(([draft, intent, background], index) => ({
    id: `${category}-${index + 1}`,
    category,
    surface,
    app,
    draft,
    intent,
    ...(background ? { background } : {}),
  }));
}

const ghostty = "com.mitchellh.ghostty";

export const PROMPT_IMPROVEMENT_CASES: readonly PromptImprovementCase[] = [
  ...group("email", "email", "com.apple.mail", [
    ["Hi Maya,\n\nThanks for taking the time to", "Continue a warm professional thank-you."],
    ["I wanted to follow up on", "Continue a concise follow-up without inventing specifics."],
    ["Would Thursday afternoon work", "Finish a scheduling question naturally."],
    ["I've attached the revised", "Complete a common attachment sentence."],
    ["Please let me know if", "Continue a polite request."],
    ["To clarify my earlier note,", "Continue a professional clarification."],
    ["Unfortunately, we won't be able to", "Continue a tactful negative update."],
    ["Best regards,\nAnth", "Complete the partial signature name without a leading space."],
  ]),
  ...group("claude-code", "Ghostty · Claude Code", ghostty, [
    ["please update the", "Continue a coding-agent instruction with a plausible object.", "Claude Code is waiting for the next user instruction in a TypeScript repository."],
    ["run the tests and", "Continue an imperative coding task.", "The previous implementation is complete but has not been verified."],
    ["now add tests for", "Continue a request for test coverage.", "Claude Code just implemented authentication error handling."],
    ["investigate why the", "Continue a debugging request without pretending to know the cause.", "The terminal shows an intermittent CI failure."],
    ["refactor this so that", "Continue a refactoring goal naturally.", "The user is prompting Claude Code about a large React component."],
    ["before committing, please", "Continue a concise verification instruction.", "Claude Code has modified four files."],
  ]),
  ...group("codex", "Ghostty · Codex", ghostty, [
    ["implement the missing", "Continue a concrete implementation request.", "Codex is working in a desktop TypeScript application."],
    ["check the current diff for", "Continue a code-review instruction.", "There are uncommitted changes in the repository."],
    ["fix the failing", "Complete a short repair request.", "Codex reported two failing integration tests."],
    ["keep the existing behavior but", "Continue a constrained change request.", "The user wants a narrow implementation change."],
    ["use the existing component and", "Continue an instruction that favors reuse.", "Codex is editing a React settings surface."],
    ["once that passes,", "Continue the next step in an agent workflow.", "Codex is currently running the focused test."],
  ]),
  ...group("opencode", "Ghostty · OpenCode", ghostty, [
    ["can you trace where", "Continue a repository investigation request.", "OpenCode has access to the local repository and terminal."],
    ["add support for", "Continue a feature request without unsupported specificity.", "The project has an extensible provider catalog."],
    ["compare this implementation with", "Continue a comparison request.", "OpenCode just opened the current module."],
    ["don't change the API, just", "Continue a tightly scoped coding instruction.", "The public interface must remain stable."],
    ["please clean up the", "Continue a maintenance request.", "OpenCode identified duplicated setup code."],
    ["after the build finishes,", "Continue a likely next action.", "OpenCode is waiting for a production build."],
  ]),
  ...group("team-message", "team chat", "com.tinyspeck.slackmacgap", [
    ["I reviewed the proposal and", "Continue a neutral team update."],
    ["The deploy finished, but", "Continue a cautious deployment update."],
    ["Let's move the sync to", "Continue a scheduling message."],
    ["No blocker from my side,", "Continue a concise status response."],
    ["Small correction: the branch is", "Continue without inventing a branch name."],
    ["I reproduced it when", "Continue a debugging observation without invented detail."],
  ]),
  ...group("personal-message", "personal message", "com.apple.MobileSMS", [
    ["Running a few minutes", "Finish a common lateness update."],
    ["Happy birthday! Hope you", "Continue a warm birthday message."],
    ["Could we reschedule for", "Continue a scheduling question."],
    ["I left the keys", "Continue a useful short message."],
    ["I'll be there in about", "Continue a time estimate without inventing a precise number."],
    ["See you tom", "Complete the partial word tomorrow without a leading space."],
  ]),
  ...group("document", "document editor", "com.microsoft.Word", [
    ["The experiment showed a clear", "Continue analytical prose."],
    ["This approach works because", "Continue an explanation."],
    ["Although the first attempt failed,", "Continue a contrastive sentence."],
    ["The results do not imply", "Continue a careful limitation."],
    ["Our recommendation is to", "Continue a recommendation."],
    ["A successful rollout depends", "Continue formal business prose."],
  ]),
  ...group("notes", "notes", "com.apple.Notes", [
    ["Groceries:\n- coffee\n- rice\n-", "Suggest a plausible short grocery item."],
    ["Ideas for the weekend:\n", "Start a concise idea."],
    ["Remember to call", "Continue a reminder without inventing a person."],
    ["Open questions:\n1. Who owns", "Continue an open-question item."],
    ["Workout plan:\nMonday —", "Continue a short workout-plan entry."],
    ["Packing list for Montréal:\n-", "Suggest a plausible packing item."],
  ]),
  ...group("support-sales", "browser text field", "com.google.Chrome", [
    ["Thanks for reaching out about", "Continue a helpful support response."],
    ["I understand how frustrating", "Continue an empathetic response."],
    ["The next step is to", "Continue a clear action without invented specifics."],
    ["Based on your requirements,", "Continue a consultative sales note."],
    ["I'd be happy to schedule", "Continue a call-to-action."],
    ["We can offer a", "Continue carefully without inventing pricing or terms."],
  ]),
  ...group("multilingual", "mixed writing surfaces", "com.apple.MobileSMS", [
    ["Nos vemos mañana a", "Continue naturally in Spanish."],
    ["¿Puedes ayudarme con", "Continue naturally in Spanish."],
    ["Merci beaucoup pour", "Continue naturally in French."],
    ["On se retrouve à", "Continue naturally in French."],
    ["The café meeting is", "Continue naturally with accented context."],
    ["Renée said she would", "Continue naturally without altering the name."],
  ]),
];
