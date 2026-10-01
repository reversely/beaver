import assert from "node:assert/strict";
import { test } from "node:test";
import { viewerKey } from "../src/auth.ts";
import { addTurn, checkTurn, MAX_TURNS } from "../src/turns.ts";

const turn = {
  question: "What is poutine?",
  visitor: { name: "English", code: "en" },
  sentences: [{ group: 0, code: "en", text: "Fries, curds, gravy." }],
  extra: "<script>",
};

test("a checked turn keeps only its expected fields and stamps its time", () => {
  const checked = checkTurn(turn, new Date("2026-10-01T12:00:00Z"));
  assert.equal(checked.at, "2026-10-01T12:00:00.000Z");
  assert.equal("extra" in checked, false);
  assert.deepEqual(checked.sentences, turn.sentences);
});

test("a turn with missing or oversized fields is refused", () => {
  assert.throws(() => checkTurn(null), TypeError);
  assert.throws(() => checkTurn({ ...turn, question: 5 }), TypeError);
  assert.throws(() => checkTurn({ ...turn, question: "x".repeat(2001) }), TypeError);
  assert.throws(() => checkTurn({ ...turn, sentences: [{ group: "0", code: "en", text: "a" }] }));
  assert.throws(() => checkTurn({ ...turn, sentences: new Array(41).fill(turn.sentences[0]) }));
});

test("the session keeps the latest turns only", () => {
  let turns = [];
  for (let i = 0; i < MAX_TURNS + 5; i++) turns = addTurn(turns, checkTurn({ ...turn, question: `${i}` }));
  assert.equal(turns.length, MAX_TURNS);
  assert.equal(turns.at(-1).question, `${MAX_TURNS + 4}`);
});

test("viewer keys differ per session and match the laptop's derivation", async () => {
  const a = await viewerKey("secret", "desktop");
  assert.equal(a.length, 32);
  assert.notEqual(a, await viewerKey("secret", "other"));
  // python3 -c "import hmac,hashlib;print(hmac.new(b'secret',b'desktop',hashlib.sha256).hexdigest()[:32])"
  assert.equal(a, "dea9690e829a622c712e0c36eaf2833d"); // pragma: allowlist secret
});
