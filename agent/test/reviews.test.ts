import assert from "node:assert/strict";
import { test } from "node:test";
import { addDue, DEFAULT_FIRST_SECONDS, firstInterval, nextInterval, removeDue } from "../src/reviews.ts";

test("a remembered word waits longer and a forgotten one starts over", () => {
  assert.equal(nextInterval(600, true, 600), 1500);
  assert.equal(nextInterval(1500, false, 600), 600);
  assert.equal(nextInterval(10 ** 9, true, 600), 180 * 24 * 3600);
});

test("the first interval stays within one minute and thirty days", () => {
  assert.equal(firstInterval(5), 60);
  assert.equal(firstInterval(10 ** 9), 30 * 24 * 3600);
  assert.equal(firstInterval("60"), DEFAULT_FIRST_SECONDS);
  assert.equal(firstInterval(120), 120);
});

test("a word is due once and leaves the list when reviewed", () => {
  const word = { id: 1, en: "fries", fr: "frites", visitor: "fries", meaning: "potatoes" };
  const due = addDue(addDue([], word), word);
  assert.equal(due.length, 1);
  assert.deepEqual(removeDue(due, 1), []);
});
