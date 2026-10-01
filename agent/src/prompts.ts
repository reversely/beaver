// The repo's own prompt files and config values, bundled into the Worker by wrangler's Text rule
// (agent/wrangler.jsonc), so the page and the desktop app share one copy of each.
import desktopConfig from "../../src/beaver/desktop/config.toml";
import answerInline from "../../src/beaver/desktop/prompts/answer_inline.md";
import answer from "../../src/beaver/desktop/prompts/answer.md";
import imageNote from "../../src/beaver/desktop/prompts/image_note.md";
import notebook from "../../src/beaver/desktop/prompts/notebook.md";
import system from "../../src/beaver/core/prompts/system.md";
import typedQuestion from "../../src/beaver/core/prompts/typed_question.md";
import { tomlSection } from "./render.ts";
import type { Prompts } from "./turn.ts";

export const PROMPTS: Prompts = {
  system,
  typed_question: typedQuestion,
  answer,
  answer_inline: answerInline,
  image_note: imageNote,
};

export const NOTEBOOK_PROMPT = notebook;
export const PROMPT_VARS = tomlSection(desktopConfig, "prompt_vars");
export const ANSWER = tomlSection(desktopConfig, "answer");
export const NOTEBOOKS = tomlSection(desktopConfig, "notebooks");
export const REVIEW = tomlSection(desktopConfig, "review");
