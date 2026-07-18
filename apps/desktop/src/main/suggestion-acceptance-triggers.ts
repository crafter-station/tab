export function createSuggestionAcceptanceTriggers(
  acceptCurrentSuggestion: () => Promise<void>,
) {
  return {
    keyboard: acceptCurrentSuggestion,
    click: acceptCurrentSuggestion,
  };
}
