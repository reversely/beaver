import assert from "node:assert/strict";
import { test } from "node:test";
import { render, tomlSection } from "../src/render.ts";
import { group, orderedCodes, splitSentences } from "../src/sentences.ts";
import { answerTurn, type Run } from "../src/turn.ts";
import { joinWavs, splitTagged, tagged } from "../src/voice-text.ts";
import { wav } from "../src/utterances.ts";

test("sentences split as core/sentences.py splits them", () => {
  assert.deepEqual(splitSentences("Walk to St. Laurent Blvd. Then turn. 好吃！很好。"), [
    "Walk to St. Laurent Blvd. Then turn.",
    "好吃！",
    "很好。",
  ]);
});

test("languages are ordered and a short translation is dropped", () => {
  const settings = { official: "both", include_visitor_language: true, order: "visitor_first" } as const;
  assert.deepEqual(orderedCodes(settings, "es"), ["es", "en", "fr"]);
  assert.deepEqual(orderedCodes(settings, "fr"), ["en", "fr"]);
  const out = group(["fr", "en", "es"], { fr: ["Salut."], en: ["Hi."], es: [] }, 1);
  assert.deepEqual(out.groups, [[["fr", "Salut."], ["en", "Hi."]]]);
  assert.deepEqual(out.dropped, ["es"]);
});

test("prompts fill like string.Template and refuse a missing name", () => {
  assert.equal(render("Hi ${a}, ${b}.", { a: 1, b: "x" }), "Hi 1, x.");
  assert.throws(() => render("${missing}", {}), /missing/);
  assert.equal(render("${n}", { n: "${notebooks}" }), "${notebooks}");
});

test("a TOML section reads strings, numbers, booleans, and one-line arrays", () => {
  const text = '[a]\nx = "Beaver"  # name\ny = 3\n[b]\nz = true\nw = ["en", "fr"]\nlong = [\n "a",\n]\n';
  assert.deepEqual(tomlSection(text, "a"), { x: "Beaver", y: 3 });
  assert.deepEqual(tomlSection(text, "b"), { z: true, w: ["en", "fr"] });
});

const config = {
  prompts: {
    system: "You are ${guide_name}.",
    typed_question: 'The visitor asks: "${question}"',
    answer: "Answer in ${source_language} within ${max_characters}.",
    answer_inline: "Answer in ${target_languages}.",
    image_note: "An image is attached.",
  },
  vars: { guide_name: "Beaver" },
  max_characters: 280,
  answer_model: "answer",
  translate_model: "m2m100",
};

test("a translate-mode turn answers, splits, and translates each sentence", async () => {
  const calls: Record<string, unknown>[] = [];
  const run: Run = async (model, input) => {
    calls.push({ model, ...input });
    if (model === "m2m100") return { translated_text: `[${input.target_lang}] ${input.text}` };
    return {
      response: {
        question: "q",
        visitor_language_name: "Spanish",
        visitor_language_code: "es",
        answer: "Poutine comes from Quebec. It has curds.",
      },
    };
  };
  const result = await answerTurn(run, config, {
    question: "¿Qué es la poutine?",
    image_jpeg: "AAAA",
    languages: { official: "en", include_visitor_language: true, order: "official_first" },
    mode: "translate",
  });
  assert.deepEqual(result.codes, ["en", "es"]);
  assert.deepEqual(result.groups[1], [["en", "It has curds."], ["es", "[es] It has curds."]]);
  const ask = calls[0] as { messages: { content: unknown }[] };
  assert.equal((ask.messages[0] as { content: string }).content, "You are Beaver.");
  const parts = ask.messages[1].content as { type: string; text?: string }[];
  assert.equal(parts[0].type, "image_url");
  assert.equal(parts[1].text, 'The visitor asks: "¿Qué es la poutine?"');
  assert.match(parts[2].text!, /^An image is attached\.\n\nAnswer in English within 280\.$/);
  assert.equal(calls.filter((c) => c.model === "m2m100").length, 2);
});

test("an inline-mode turn takes every language from the answer model", async () => {
  const run: Run = async () => ({
    response: {
      question: "q",
      visitor_language_name: "Chinese",
      visitor_language_code: "zh-Hant",
      sentences: [{ en: "Poutine is from Quebec.", visitor: "Poutine 來自魁北克。" }],
    },
  });
  const result = await answerTurn(run, config, {
    question: "q",
    languages: { official: "en", include_visitor_language: true, order: "visitor_first" },
    mode: "inline",
  });
  assert.deepEqual(result.groups, [[["zh", "Poutine 來自魁北克。"], ["en", "Poutine is from Quebec."]]]);
  assert.equal(result.visitor.tag, "zh-Hant");
});

test("tagged text splits back into languages, even when the chunker merges sentences", () => {
  const text = tagged([[["en", "Yes."], ["fr", "Oui."]], [["en", "Ottawa is the capital."]]]);
  assert.deepEqual(splitTagged(text), [
    { code: "en", text: "Yes." },
    { code: "fr", text: "Oui." },
    { code: "en", text: "Ottawa is the capital." },
  ]);
  assert.deepEqual(splitTagged("continued text", "fr"), [{ code: "fr", text: "continued text" }]);
});

test("joined WAV clips keep one header and every sample", () => {
  const joined = joinWavs([wav(new Int16Array([1, 2])), wav(new Int16Array([3]))]);
  const view = new DataView(joined.buffer);
  assert.equal(view.getUint32(40, true), 6);
  assert.deepEqual([...new Int16Array(joined.buffer.slice(44))], [1, 2, 3]);
});

test("a sentence reporting the visitor's language is recognised as the Python rule does", async () => {
  const { readFileSync } = await import("node:fs");
  const { namesVisitorLanguage } = await import("../src/turn.ts");
  const cases = JSON.parse(readFileSync(new URL("../../src/beaver/desktop/tests/language_report_cases.json", import.meta.url), "utf8"));
  for (const c of cases) assert.equal(namesVisitorLanguage(c.sentence, c.name, c.code), c.drop, c.sentence);
});

test("a translate-mode turn drops the model's language report before translating", async () => {
  const calls: string[] = [];
  const run: Run = async (model, input) => {
    if (model === "m2m100") {
      calls.push(String(input.text));
      return { translated_text: `[fr] ${input.text}` };
    }
    return { response: { question: "q", visitor_language_name: "Spanish", visitor_language_code: "es", answer: "The visitor spoke Spanish, es. Ottawa is the capital." } };
  };
  const result = await answerTurn(run, config, {
    question: "q",
    languages: { official: "en", include_visitor_language: true, order: "official_first" },
    mode: "translate",
  });
  assert.deepEqual(result.groups, [[["en", "Ottawa is the capital."], ["es", "[fr] Ottawa is the capital."]]]);
  assert.deepEqual(calls, ["Ottawa is the capital."]);
});
