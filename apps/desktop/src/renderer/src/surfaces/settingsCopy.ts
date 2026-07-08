import type { PersonalMemoryCreatedBy } from "@tabb/contracts";

type PauseStateDescription = {
  label: string;
  description: string;
  action: string;
};

export function describePauseState(paused: boolean): PauseStateDescription {
  if (paused) {
    return {
      label: "Paused",
      description: "Typing Context observation and Suggestions are disabled.",
      action: "Resume Tabb",
    };
  }

  return {
    label: "Active",
    description: "Typing Context observation and Suggestions are running.",
    action: "Pause Tabb",
  };
}

export function describePersonalMemorySource(createdBy: PersonalMemoryCreatedBy) {
  switch (createdBy) {
    case "user":
      return "Saved by you";
    case "system":
      return "Learned from accepted writing";
  }
}
