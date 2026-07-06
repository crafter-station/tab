import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

const expectedWorkspaces = ["apps/*", "packages/*"];

const workspaceEntrypoints = [
  "apps/desktop",
  "apps/web",
  "apps/api",
  "packages/contracts",
  "packages/memory-policy",
  "packages/redaction",
  "packages/billing",
  "packages/effect-services",
];

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function readText(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("Tabb monorepo bootstrap", () => {
  it("defines app and shared package workspaces with CI-ready commands", () => {
    const rootPackage = readJson("package.json");

    assert.deepEqual(rootPackage.workspaces, expectedWorkspaces);
    assert.equal(rootPackage.scripts.typecheck, "tsc -p tsconfig.json --noEmit");
    assert.equal(rootPackage.scripts.test, "node --test tests/*.test.mjs");
    assert.equal(rootPackage.scripts.lint, "tsc -p tsconfig.json --noEmit");

    for (const workspace of workspaceEntrypoints) {
      assert.ok(existsSync(join(root, workspace, "package.json")), `${workspace} has a package manifest`);
      assert.ok(existsSync(join(root, workspace, "src/index.ts")), `${workspace} has a source entrypoint`);
    }
  });

  it("keeps shared contracts and contributor references aligned with the PRD", () => {
    const contracts = readText("packages/contracts/src/index.ts");
    assert.match(contracts, /SuggestionRequestSchema/);
    assert.match(contracts, /SuggestionResponseSchema/);
    assert.match(contracts, /suggestions: z\.array/);

    const redaction = readText("packages/redaction/src/index.ts");
    assert.match(redaction, /redactSensitiveText/);
    assert.match(redaction, /api[_-]?key|bearer|private key/i);

    const contributorDocs = readText("CONTRIBUTING.md");
    assert.match(contributorDocs, /CONTEXT\.md/);
    assert.match(contributorDocs, /docs\/adr/);
    assert.match(contributorDocs, /Effect/);
    assert.match(contributorDocs, /npm run typecheck/);
    assert.match(contributorDocs, /npm run test/);
  });
});
