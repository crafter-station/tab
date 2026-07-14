import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const script = readFileSync(
  new URL("../apps/web/public/marketing-demo.js", import.meta.url),
  "utf8",
);

function createHarness() {
  const listeners = new Map();
  const announcement = { textContent: "" };
  const demo = {
    dataset: { accepted: "false" },
    hasAttribute: () => false,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const workflow = {
    dataset: { accepted: "false" },
    hasAttribute: (name) => name === "data-tab-workflow",
    querySelector: (selector) =>
      selector === "[data-workflow-announcement]" ? announcement : null,
  };
  const body = { closest: () => null };
  const document = {
    activeElement: body,
    addEventListener: (type, listener) => listeners.set(type, listener),
    querySelector: (selector) =>
      selector === "[data-tab-demo]" ? demo : null,
    querySelectorAll: (selector) => {
      if (selector === "[data-tab-demo]") return [demo];
      return [];
    },
  };
  const window = {
    clearTimeout: () => {},
    setTimeout: () => 1,
  };

  vm.runInNewContext(script, {
    document,
    Element: class Element {},
    requestAnimationFrame: () => {},
    window,
  });

  return { demo, document, listeners, workflow };
}

function shortcutEvent(overrides = {}) {
  let prevented = false;
  return {
    altKey: true,
    code: "Tab",
    key: "Tab",
    preventDefault: () => {
      prevented = true;
    },
    wasPrevented: () => prevented,
    ...overrides,
  };
}

test("Option+Tab accepts the landing demo without requiring focus first", () => {
  const { demo, listeners } = createHarness();
  const event = shortcutEvent();

  listeners.get("keydown")(event);

  assert.equal(demo.dataset.accepted, "true");
  assert.equal(event.wasPrevented(), true);
});

test("Option+Tab accepts the focused workflow demo", () => {
  const { demo, document, listeners, workflow } = createHarness();
  document.activeElement = {
    closest: (selector) =>
      selector === "[data-tab-workflow]" ? workflow : null,
  };
  const event = shortcutEvent({ key: "Unidentified" });

  listeners.get("keydown")(event);

  assert.equal(workflow.dataset.accepted, "true");
  assert.equal(demo.dataset.accepted, "false");
  assert.equal(event.wasPrevented(), true);
});
