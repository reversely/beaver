// node --test agent/test/*.test.ts (Node strips the types; no build step).
import assert from "node:assert/strict";
import { test } from "node:test";
import { hasToken, sameText } from "../src/auth.ts";
import {
  audioBytes,
  chatInput,
  collectTranslations,
  replyText,
  translationJobs,
} from "../src/workers-ai.ts";

test("the token check accepts only the exact bearer token", () => {
  const ask = (header?: string) =>
    new Request("https://x/", { headers: header ? { Authorization: header } : {} });
  assert.equal(hasToken(ask("Bearer secret"), "secret"), true);
  assert.equal(hasToken(ask("Bearer secreT"), "secret"), false);
  assert.equal(hasToken(ask("secret"), "secret"), false);
  assert.equal(hasToken(ask(), "secret"), false);
  // An unset secret refuses everything rather than accepting an empty token.
  assert.equal(hasToken(ask("Bearer "), ""), false);
  assert.equal(sameText("abc", "abcd"), false);
});

test("chat input puts parts before the instruction and adds JSON mode only with a schema", () => {
  const input = chatInput({
    system: "S",
    instruction: "I",
    parts: [{ image_jpeg: "AAAA" }, { text: "Q" }],
  }) as { messages: { content: unknown }[]; response_format?: unknown };
  assert.deepEqual(input.messages[1].content, [
    { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
    { type: "text", text: "Q" },
    { type: "text", text: "I" },
  ]);
  assert.equal(input.response_format, undefined);
  const withSchema = chatInput({ system: "S", instruction: "I", parts: [], schema: { type: "object" } });
  assert.deepEqual(withSchema.response_format, {
    type: "json_schema",
    json_schema: { type: "object" },
  });
});

test("reply text reads string, object, and chat-completion replies", () => {
  assert.equal(replyText({ response: " hi " }), "hi");
  assert.equal(replyText({ response: { a: 1 } }), '{"a":1}');
  assert.equal(replyText({ choices: [{ message: { content: "yo" } }] }), "yo");
  assert.equal(replyText(null), "");
});

test("translations come back in sentence order per target", () => {
  const jobs = translationJobs(["one", "two"], ["fr", "es"]);
  assert.equal(jobs.length, 4);
  const texts = jobs.map((j) => `${j.target}:${j.text}`);
  assert.deepEqual(collectTranslations(jobs, texts, 2), {
    fr: ["fr:one", "fr:two"],
    es: ["es:one", "es:two"],
  });
});

test("speech audio decodes from base64 or bytes", async () => {
  assert.deepEqual(await audioBytes({ audio: btoa("ID3") }), new TextEncoder().encode("ID3"));
  assert.deepEqual(await audioBytes(new Uint8Array([1, 2])), new Uint8Array([1, 2]));
  await assert.rejects(audioBytes({}), /no audio/);
});
