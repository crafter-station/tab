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
      description: "Tab has stopped Suggestions and recent typing checks.",
      action: "Resume Suggestions",
    };
  }

  return {
    label: "On",
    description: "Tab can suggest as you type.",
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
