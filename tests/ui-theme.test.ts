import { describe, expect, it } from "bun:test";
import { applyThemePreference } from "../packages/ui/src/theme.ts";

type TestElement = {
  dataset: Record<string, string | undefined>;
  classList: {
    add(value: string): void;
    remove(value: string): void;
    contains(value: string): boolean;
  };
};

function createElement(): TestElement {
  const classes = new Set<string>();
  return {
    dataset: {},
    classList: {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value),
      contains: (value) => classes.has(value),
    },
  };
}

function createStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: (key: string) => (key === "tabb-theme" ? value : null),
    setItem: (key: string, nextValue: string) => {
      if (key === "tabb-theme") value = nextValue;
    },
  };
}

describe("shared theme behavior", () => {
  it("defaults to system dark mode when no local preference is stored", () => {
    const element = createElement();

    const applied = applyThemePreference({
      element,
      storage: createStorage(),
      systemPrefersDark: () => true,
    });

    expect(applied).toBe("dark");
    expect(element.dataset.theme).toBe("dark");
    expect(element.classList.contains("dark")).toBe(true);
  });

  it("uses and persists an explicit light preference over system dark mode", () => {
    const element = createElement();

    const applied = applyThemePreference({
      element,
      mode: "light",
      storage: createStorage("dark"),
      systemPrefersDark: () => true,
    });

    expect(applied).toBe("light");
    expect(element.dataset.theme).toBe("light");
    expect(element.classList.contains("dark")).toBe(false);
  });
});
