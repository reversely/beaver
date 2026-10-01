import assert from "node:assert/strict";
import { test } from "node:test";
import { checkFiling, listing, newId } from "../src/notebooks.ts";

const request = {
  prompt: "",
  schema: {},
  pieces: ["poutine", "flag"],
  themes: ["civic", "culture"],
  max_vocabulary: 2,
  max_concepts: 1,
  answer: "",
};
const reply = {
  notebook: { id: "", title_en: "Poutine", title_fr: "La poutine", theme: "culture", artifact: "poutine", year_start: 1950, year_end: 1960 },
  vocabulary: [1, 2, 3].map((i) => ({ en: `w${i}`, fr: `m${i}`, visitor: `v${i}`, meaning: "m" })),
  concepts: [1, 2].map((i) => ({ title: `c${i}`, summary: "s", why_it_matters: "w" })),
  moments: [{ year: 1957, event: "First served" }],
};

test("a filing is trimmed to the limits", () => {
  const filing = checkFiling(reply, request);
  assert.equal(filing.vocabulary.length, 2);
  assert.equal(filing.concepts.length, 1);
  assert.equal(filing.notebook.artifact, "poutine");
});

test("an unlisted piece is dropped and an unlisted theme is refused", () => {
  const odd = { ...reply, notebook: { ...reply.notebook, artifact: "<img src=x>" } };
  assert.equal(checkFiling(odd, request).notebook.artifact, null);
  assert.throws(() => checkFiling({ ...reply, notebook: { ...reply.notebook, theme: "x" } }, request), TypeError);
  assert.throws(() => checkFiling({ ...reply, moments: [{ year: "1957", event: "e" }] }, request), TypeError);
  assert.throws(() => checkFiling(null, request), TypeError);
});

test("the listing matches the laptop's lines", () => {
  assert.equal(listing([]), "(none yet)");
  assert.equal(
    listing([{ id: "ab12cd34", title_en: "Poutine", title_fr: "", theme: "culture", artifact: null, year_start: 1950, year_end: 1960 }]),
    "- id ab12cd34: Poutine (culture, 1950-1960)",
  );
  assert.match(newId(), /^[0-9a-f]{8}$/);
});
