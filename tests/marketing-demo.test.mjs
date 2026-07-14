import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const provider = readFileSync(new URL("../apps/web/src/components/marketing/interaction-provider.tsx", import.meta.url), "utf8");
const autocomplete = readFileSync(new URL("../apps/web/src/components/marketing/autocomplete-demo.tsx", import.meta.url), "utf8");
const controls = readFileSync(new URL("../apps/web/src/components/marketing/controls.tsx", import.meta.url), "utf8");

test("marketing interactions are hydrated components using shared controls", () => {
  assert.match(autocomplete, /TabsList/);
  assert.match(autocomplete, /TabsTrigger/);
  assert.match(controls, /<Toggle/);
  assert.match(controls, /<Button/);
});

test("Option+Tab keeps a primary fallback while double Option targets the active surface", () => {
  assert.match(provider, /active\?\.accept \? active : primarySurface\.current/);
  assert.match(provider, /event\.altKey/);
  assert.match(provider, /event\.key !== "Tab" && event\.code !== "Tab"/);
  assert.match(provider, /now - lastOptionTap\.current < 400/);
  assert.match(provider, /surface\.deepComplete\(\)/);
  assert.match(provider, /event\.preventDefault\(\)/);
});

test("motion controls preserve reduced-motion, SVG pause, and replay hooks", () => {
  assert.match(controls, /prefers-reduced-motion: reduce/);
  assert.match(controls, /pauseAnimations/);
  assert.match(controls, /unpauseAnimations/);
  assert.match(controls, /requestAnimationFrame\(\(\) => requestAnimationFrame/);
});
