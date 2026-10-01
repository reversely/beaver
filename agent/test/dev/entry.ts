// Local run of the agent with a stub in place of Workers AI, which `wrangler dev` can only reach
// with a Cloudflare login. It exercises the Durable Object, state sync, SQL, and the scheduler:
//   npx wrangler dev -c test/dev/wrangler.jsonc
import worker, { BeaverGuide as Real, type Env } from "../../src/index.ts";

const ANSWER = {
  question: "What is poutine?",
  visitor_language_name: "English",
  visitor_language_code: "en",
  answer: "Poutine comes from Quebec. It is fries with cheese curds and gravy.",
};
const FILING = {
  notebook: { id: "", title_en: "Poutine", title_fr: "La poutine", theme: "culture", artifact: "poutine", year_start: 1950, year_end: 1960 },
  vocabulary: [
    { en: "cheese curds", fr: "fromage en grains", visitor: "cheese curds", meaning: "Fresh lumps of cheese" },
    { en: "gravy", fr: "sauce brune", visitor: "gravy", meaning: "A brown sauce" },
  ],
  concepts: [{ title: "Quebec food", summary: "Poutine began in rural Quebec.", why_it_matters: "It is served across Canada." }],
  moments: [{ year: 1957, event: "Poutine first served in Warwick, Quebec" }],
};

const stubAI = {
  async run(model: string, input: Record<string, unknown>) {
    if (model.includes("m2m100")) return { translated_text: `[${input.target_lang}] ${input.text}` };
    if (model.includes("melotts")) return { audio: btoa("ID3stub") };
    const format = input.response_format as { json_schema?: { properties?: object } } | undefined;
    const filing = format?.json_schema?.properties && "notebook" in format.json_schema.properties;
    return { response: filing ? FILING : ANSWER, usage: { prompt_tokens: 1, completion_tokens: 1 } };
  },
};

export class BeaverGuide extends Real {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx as never, { ...env, AI: stubAI as unknown as Ai });
  }
}

export default worker;
