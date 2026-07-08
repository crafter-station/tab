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
      description: "Suggestions and recent typing checks are paused.",
      action: "Resume Tab",
    };
  }

  return {
    label: "Active",
    description: "Suggestions and recent typing checks are running.",
    action: "Pause Tab",
  };
}

export function describePersonalMemorySource(createdBy: PersonalMemoryCreatedBy) {
  switch (createdBy) {
    case "user":
      return "Saved by you";
    case "system":
      return "Saved from accepted writing";
  }
}
