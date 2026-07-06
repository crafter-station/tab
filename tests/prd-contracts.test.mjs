import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

const prdPath = "docs/PRD.md";
const contextPath = "CONTEXT.md";
const contributingPath = "CONTRIBUTING.md";

const prdRequiredSections = [
  /## Problem Statement/,
  /## Solution/,
  /## User Stories/,
  /## Implementation Decisions/,
  /## Testing Decisions/,
  /## Out of Scope/,
  /## Further Notes/,
];

const canonicalGlossaryTerms = [
  "Native Autocomplete App",
  "Suggestion",
  "Acceptance",
  "Active Application",
  "Typing Context",
  "Floating Suggestion Overlay",
  "Personal Memory",
];

function readText(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("Tabb MVP PRD contracts", () => {
  it("publishes the PRD at docs/PRD.md with all required sections", () => {
    const prdFullPath = join(root, prdPath);
    assert.ok(existsSync(prdFullPath), "PRD file exists at docs/PRD.md");

    const prd = readText(prdPath);
    for (const section of prdRequiredSections) {
      assert.match(prd, section, `PRD contains section matching ${section}`);
    }
  });

  it("references CONTEXT.md as the canonical product glossary", () => {
    const prd = readText(prdPath);
    assert.match(prd, /CONTEXT\.md/);
    assert.match(prd, /canonical product language/i);

    const context = readText(contextPath);
    for (const term of canonicalGlossaryTerms) {
      assert.match(context, new RegExp(`\\*\\*${term}\\*\\*`), `CONTEXT.md defines ${term}`);
    }
  });

  it("links contributor guidance to the PRD, glossary, ADRs, and conventions", () => {
    const contributorDocs = readText(contributingPath);
    assert.match(contributorDocs, /docs\/PRD\.md/, "CONTRIBUTING.md references docs/PRD.md");
    assert.match(contributorDocs, /CONTEXT\.md/, "CONTRIBUTING.md references CONTEXT.md");
    assert.match(contributorDocs, /docs\/adr\//, "CONTRIBUTING.md references docs/adr/");
    assert.match(contributorDocs, /Effect/, "CONTRIBUTING.md references Effect");
  });

  it("keeps PRD plan definitions aligned with shared billing quotas", () => {
    const prd = readText(prdPath);
    const billing = readText("packages/billing/src/index.ts");

    assert.match(billing, /free:/);
    assert.match(billing, /monthlyAutocompleteSuggestions:\s*100/);
    assert.match(billing, /pro:/);
    assert.match(billing, /monthlyAutocompleteSuggestions:\s*1[_,]000/);
    assert.match(billing, /max:/);
    assert.match(billing, /monthlyAutocompleteSuggestions:\s*1[_,]000[_,]000/);

    assert.match(prd, /Free with 100 autocompletes per month/);
    assert.match(prd, /Pro user.*1,000 autocompletes per month for \$10/);
    assert.match(prd, /Max user.*1,000,000 autocompletes per month for \$100/);
  });

  it("keeps PRD context sources aligned with shared request schema", () => {
    const prd = readText(prdPath);
    const contracts = readText("packages/contracts/src/index.ts");

    for (const source of ["typed_text", "pasted_text", "terminal_input"]) {
      assert.match(contracts, new RegExp(`"${source}"`), `contracts schema includes ${source}`);
      assert.ok(
        prd.toLowerCase().includes(source.replace("_", " ")),
        `PRD discusses ${source}`,
      );
    }
  });
});
