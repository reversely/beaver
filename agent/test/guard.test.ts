// The web guard against the cases the Python guard produced (src/beaver/core/guard_cases.json).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { redact } from "../../src/beaver/desktop/ui/guard.js";

const cases = JSON.parse(
  readFileSync(new URL("../../src/beaver/core/guard_cases.json", import.meta.url), "utf8"),
);

for (const c of cases) {
  test(`guard: ${c.input.slice(0, 50)}`, () => {
    const result = redact(c.input);
    assert.equal(result.text, c.output);
    assert.deepEqual(result.rules, c.rules);
  });
}
