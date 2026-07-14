import type { PersonalMemoryCreatedBy } from "@tab/contracts";

type PauseStateDescription = {
  label: string;
  description: string;
  action: string;
};

export function describePauseState(paused: boolean): PauseStateDescription {
  if (paused) {
    return {
      label: "Paused",
      description: "Tab will not suggest as you type.",
      action: "Resume Suggestions",
    };
  }

  return {
    label: "On",
    description: "Tab suggests as you type.",
    action: "Pause Suggestions",
  };
}

export function describePersonalMemorySource(createdBy: PersonalMemoryCreatedBy) {
  switch (createdBy) {
    case "user":
      return "Created by you";
    case "system":
      return "Learned from accepted writing";
  }
}
