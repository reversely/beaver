// One turn's answer in every spoken language (#64): the agent's port of desktop/bilingual.py,
// shared by the page's `turn` action and the voice pipeline. The caller guards the question
// before and every sentence after. Model calls go through `run`, so tests pass a stub.

import { render } from "./render.ts";
import {
  group,
  type Group,
  type LanguageSettings,
  NAMES,
  officialCodes,
  orderedCodes,
  splitSentences,
  visitorOf,
} from "./sentences.ts";
import { type Span, span } from "./trace.ts";
import { chatInput, replyText, usage } from "./workers-ai.ts";

export type Run = (model: string, input: Record<string, unknown>) => Promise<unknown>;

export interface Prompts {
  system: string;
  typed_question: string;
  answer: string;
  answer_inline: string;
  image_note: string;
}

export interface TurnConfig {
  prompts: Prompts;
  // [prompt_vars] from the desktop config.toml, so both apps fill the prompts alike.
  vars: Record<string, unknown>;
  max_characters: number;
  answer_model: string;
  translate_model: string;
}

export interface TurnInput {
  question: string;
  image_jpeg?: string;
  languages: LanguageSettings;
  // "translate": m2m100 translates each sentence. "inline": the answer model writes every language.
  mode: "translate" | "inline";
}

export interface TurnResult {
  question: string;
  visitor: { name: string; tag: string; code: string };
  codes: string[];
  groups: Group[];
  timings_ms: Record<string, number>;
  // The model calls this turn made, for the demo mode's panel (#67).
  trace: Span[];
}

const VISITOR_FIELDS = {
  question: { type: "string", description: "The visitor's question, word for word, in their language." },
  visitor_language_name: { type: "string", description: "The English name of the language the visitor used." },
  visitor_language_code: {
    type: "string",
    description: "BCP 47 tag with the script where it matters, such as ar, es, zh-Hant, zh-Hans",
  },
};

const ANSWER_ONLY = "Only the reply to the question; never mention the visitor's language.";

// A sentence that addresses the visitor, names their language, and gives its code or "ISO" is a
// report of the language, which the schema asks for in its own fields; Llama 4 Scout also writes
// it into the answer (#68). Ported from bilingual.names_visitor_language; both pass
// src/beaver/desktop/tests/language_report_cases.json. Fixed words, never model output.
const ADDRESSES_VISITOR = ["visitor", "visiteur", "you ", "you'", "vous"];

export function namesVisitorLanguage(sentence: string, name: string, code: string): boolean {
  const lower = sentence.toLowerCase();
  if (!ADDRESSES_VISITOR.some((w) => lower.includes(w))) return false;
  const named = Boolean(name) && lower.includes(name.toLowerCase());
  const french = (lower.includes("visiteur") || lower.includes("vous")) && (lower.includes("parl") || lower.includes("langue"));
  if (!named && !french) return false;
  const escaped = code.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return lower.includes("iso") || new RegExp(`(?<![a-z])${escaped}(?![a-z])`).test(lower);
}

function instruction(config: TurnConfig, role: "answer" | "answer_inline", image: boolean, values: object) {
  const notes = image ? [render(config.prompts.image_note, config.vars)] : [];
  notes.push(render(config.prompts[role], { ...config.vars, ...values }));
  return notes.join("\n\n");
}

export async function answerTurn(run: Run, config: TurnConfig, input: TurnInput): Promise<TurnResult> {
  const timings: Record<string, number> = {};
  const official = officialCodes(input.languages);
  const source = official[0];
  const inline = input.mode === "inline";
  const keys = [...official, "visitor"];
  const schema = inline
    ? {
        type: "object",
        properties: {
          ...VISITOR_FIELDS,
          sentences: {
            type: "array",
            description: ANSWER_ONLY,
            items: {
              type: "object",
              properties: Object.fromEntries(keys.map((k) => [k, { type: "string" }])),
              required: keys,
            },
          },
        },
        required: [...Object.keys(VISITOR_FIELDS), "sentences"],
      }
    : {
        type: "object",
        properties: { ...VISITOR_FIELDS, answer: { type: "string", description: ANSWER_ONLY } },
        required: [...Object.keys(VISITOR_FIELDS), "answer"],
      };
  const values = inline
    ? {
        source_language: NAMES[source],
        max_characters: config.max_characters,
        target_languages:
          official.map((c) => `${NAMES[c]} (key ${c})`).join(", ") +
          ", and the visitor's language (key visitor)",
      }
    : { source_language: NAMES[source], max_characters: config.max_characters };
  const parts = [
    ...(input.image_jpeg ? [{ image_jpeg: input.image_jpeg }] : []),
    { text: render(config.prompts.typed_question, { ...config.vars, question: input.question }) },
  ];
  let start = Date.now();
  const output = await run(
    config.answer_model,
    chatInput({
      system: render(config.prompts.system, config.vars),
      instruction: instruction(config, inline ? "answer_inline" : "answer", Boolean(input.image_jpeg), values),
      parts,
      schema,
    }),
  );
  timings.answer = Date.now() - start;
  const tokens = usage(output);
  const trace: Span[] = [
    span(inline ? "Answer and translate" : "Answer", "workers-ai", timings.answer, [
      ["Model", config.answer_model],
      ["Tokens", `${tokens.prompt} in, ${tokens.reply} out`],
      ["Image", input.image_jpeg ? `${Math.round((input.image_jpeg.length * 3) / 4 / 1024)} KB camera frame` : "none"],
    ]),
  ];
  const reply = JSON.parse(replyText(output));
  const visitor = visitorOf(String(reply.visitor_language_name), String(reply.visitor_language_code));
  const codes = orderedCodes(input.languages, visitor.code);
  let translations: Record<string, string[]>;
  let count: number;
  if (inline) {
    const rows: Record<string, string>[] = (Array.isArray(reply.sentences) ? reply.sentences : []).filter(
      (r: Record<string, string>) => !namesVisitorLanguage(String(r[source] ?? ""), visitor.name, visitor.code),
    );
    translations = Object.fromEntries(official.map((c) => [c, rows.map((r) => String(r[c] ?? ""))]));
    translations[visitor.code] ??= rows.map((r) => String(r.visitor ?? ""));
    count = rows.length;
  } else {
    const sentences = splitSentences(String(reply.answer ?? "")).filter(
      (s) => !namesVisitorLanguage(s, visitor.name, visitor.code),
    );
    count = sentences.length;
    translations = { [source]: sentences };
    const others = codes.filter((c) => c !== source);
    start = Date.now();
    const done = await Promise.all(
      others.flatMap((target) =>
        sentences.map(async (text) => {
          const out = (await run(config.translate_model, {
            text,
            source_lang: source,
            target_lang: target,
          })) as { translated_text?: string };
          return (out.translated_text ?? "").trim();
        }),
      ),
    );
    others.forEach((target, t) => {
      translations[target] = done.slice(t * count, (t + 1) * count);
    });
    timings.translate = Date.now() - start;
    if (others.length) {
      trace.push(
        span("Translate", "workers-ai", timings.translate, [
          ["Model", config.translate_model],
          ["Requests", `${others.length * count} at once: ${count} sentences into ${others.join(", ")}`],
        ]),
      );
    }
  }
  const grouped = group(codes, translations, count);
  return {
    question: input.question,
    visitor,
    codes: grouped.codes,
    groups: grouped.groups,
    timings_ms: timings,
    trace,
  };
}
