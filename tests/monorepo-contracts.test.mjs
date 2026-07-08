import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

const expectedWorkspaces = ["apps/*", "packages/*"];

const ciWorkflowPath = ".github/workflows/ci.yml";
const ciWorkflowCommands = [
  /bun install --frozen-lockfile/,
  /bun run typecheck/,
  /bun run lint/,
  /bun run test/,
];

const appEntrypoints = [
  "apps/desktop",
  "apps/web",
  "apps/api",
];

const sharedPackageNames = [
  "contracts",
  "memory-policy",
  "redaction",
  "billing",
  "effect-services",
];

const sharedPackageEntrypoints = sharedPackageNames.map((name) => `packages/${name}`);
const workspaceEntrypoints = [...appEntrypoints, ...sharedPackageEntrypoints];

const sharedPackageBoundaryPattern = new RegExp(
  `@tab/(${sharedPackageNames.join("|")})["']`,
);

const contractReferences = [
  /SuggestionContextSourceSchema/,
  /RedactionSummarySchema/,
  /SuggestionRequestSchema/,
  /SuggestionResponseSchema/,
  /ApiSuccessResponseSchema/,
  /ApiErrorResponseSchema/,
  /ApiResponseSchema/,
  /z\.discriminatedUnion\("status"/,
  /contextSource: SuggestionContextSourceSchema/,
  /redaction: RedactionSummarySchema/,
  /suggestions: z\.array/,
  /status: z\.literal\("ok"\)/,
  /status: z\.literal\("error"\)/,
];

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function readText(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("Tab monorepo bootstrap", () => {
  it("defines app and shared package workspaces with CI-ready commands", () => {
    const rootPackage = readJson("package.json");

    assert.deepEqual(rootPackage.workspaces, expectedWorkspaces);
    assert.equal(rootPackage.scripts.typecheck, "tsc -p tsconfig.json --noEmit");
    assert.match(rootPackage.scripts.test, /node --test tests\/\*\.test\.mjs/);
    assert.match(rootPackage.scripts.test, /bun test/);
    assert.equal(rootPackage.scripts.lint, "tsc -p tsconfig.json --noEmit");

    for (const workspace of workspaceEntrypoints) {
      assert.ok(existsSync(join(root, workspace, "package.json")), `${workspace} has a package manifest`);
      assert.ok(existsSync(join(root, workspace, "src/index.ts")), `${workspace} has a source entrypoint`);
    }
  });

  it("provides a CI workflow that runs the install, typecheck, lint, and test commands", () => {
    const ciPath = join(root, ciWorkflowPath);
    assert.ok(existsSync(ciPath), "CI workflow file exists");

    const ciWorkflow = readText(ciWorkflowPath);
    for (const command of ciWorkflowCommands) {
      assert.match(ciWorkflow, command);
    }
  });

  it("keeps shared contracts and contributor references aligned with the PRD", () => {
    const contracts = readText("packages/contracts/src/index.ts");

    for (const contractReference of contractReferences) {
      assert.match(contracts, contractReference);
    }

    const redaction = readText("packages/redaction/src/index.ts");
    assert.match(redaction, /redactSensitiveText/);
    assert.match(redaction, /api[_-]?key|bearer|private key/i);

    const contributorDocs = readText("CONTRIBUTING.md");
    assert.match(contributorDocs, /CONTEXT\.md/);
    assert.match(contributorDocs, /docs\/adr/);
    assert.match(contributorDocs, /Effect/);
    assert.match(contributorDocs, /bun run typecheck/);
    assert.match(contributorDocs, /bun run test/);
  });

  it("connects every app boundary to at least one shared package", () => {
    for (const app of appEntrypoints) {
      const source = readText(`${app}/src/index.ts`);
      assert.match(source, sharedPackageBoundaryPattern, `${app} must reference a shared package`);
    }
  });

  it("has a repeatable install lockfile for bun install", () => {
    assert.ok(existsSync(join(root, "bun.lock")), "bun.lock exists for repeatable bun installs");
  });

  it("encodes Effect usage conventions in the shared service package", () => {
    const effectServicesPackage = readJson("packages/effect-services/package.json");
    assert.ok(
      effectServicesPackage.dependencies?.effect,
      "effect-services declares effect as a dependency",
    );

    const effectServices = readText("packages/effect-services/src/index.ts");
    assert.match(effectServices, /from ["']effect["']/, "effect-services imports from the effect package");
    assert.match(effectServices, /Effect\.Effect</, "effect-services uses Effect typed effects");
  });
});
