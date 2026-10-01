// Request shapes and reply parsing for the Workers AI models the agent calls. Kept free of
// Worker globals so `node --test` can run it.

/** Languages MeloTTS speaks, by the codes the desktop app uses. */
export const MELOTTS_LANGUAGES = new Set(["en", "es", "fr", "zh"]);

export type Part = { text: string } | { image_jpeg: string };

export interface AskRequest {
  system: string;
  instruction: string;
  parts: Part[];
  schema?: Record<string, unknown>;
  temperature?: number;
  max_tokens?: number;
}

type Content =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** The chat input for one question: parts first, then the instruction, as gemini.ask orders them. */
export function chatInput(ask: AskRequest): Record<string, unknown> {
  const content: Content[] = ask.parts.map((part) =>
    "text" in part
      ? { type: "text", text: part.text }
      : { type: "image_url", image_url: { url: `data:image/jpeg;base64,${part.image_jpeg}` } },
  );
  content.push({ type: "text", text: ask.instruction });
  const input: Record<string, unknown> = {
    messages: [
      { role: "system", content: ask.system },
      { role: "user", content },
    ],
    temperature: ask.temperature ?? 0.7,
    max_tokens: ask.max_tokens ?? 1024,
  };
  if (ask.schema) input.response_format = { type: "json_schema", json_schema: ask.schema };
  return input;
}

/** The reply text. JSON mode returns `response` as an object on some models and a string on
 * others; either way the laptop receives a JSON string. */
export function replyText(output: unknown): string {
  const response = (output as { response?: unknown } | null)?.response;
  if (typeof response === "string") return response.trim();
  if (response && typeof response === "object") return JSON.stringify(response);
  const choice = (output as { choices?: { message?: { content?: unknown } }[] } | null)
    ?.choices?.[0]?.message?.content;
  if (typeof choice === "string") return choice.trim();
  return "";
}

export interface Usage {
  prompt: number;
  reply: number;
}

export function usage(output: unknown): Usage {
  const u = (output as { usage?: { prompt_tokens?: number; completion_tokens?: number } } | null)
    ?.usage;
  return { prompt: u?.prompt_tokens ?? 0, reply: u?.completion_tokens ?? 0 };
}

/** Every (sentence, target) pair, so all translations can run at once. */
export function translationJobs(sentences: string[], targets: string[]) {
  return targets.flatMap((target) =>
    sentences.map((text, index) => ({ target, index, text })),
  );
}

/** Reassemble translated pieces into one list per target, in sentence order. */
export function collectTranslations(
  jobs: { target: string; index: number }[],
  texts: string[],
  count: number,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  jobs.forEach((job, i) => {
    result[job.target] ??= new Array<string>(count).fill("");
    result[job.target][job.index] = texts[i];
  });
  return result;
}

/** MeloTTS returns `{ audio: base64 }` or raw bytes depending on the binding version. */
export async function audioBytes(output: unknown): Promise<Uint8Array> {
  if (output instanceof Uint8Array) return output;
  if (output instanceof ArrayBuffer) return new Uint8Array(output);
  if (output instanceof ReadableStream) {
    return new Uint8Array(await new Response(output).arrayBuffer());
  }
  const audio = (output as { audio?: unknown } | null)?.audio;
  if (typeof audio === "string") return Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
  throw new Error("MeloTTS returned no audio");
}

/** The audio's media type from its first bytes: MeloTTS has returned WAV where its schema says
 * MP3, so the label follows the bytes. */
export function audioType(audio: Uint8Array): string {
  const head = String.fromCharCode(...audio.slice(0, 4));
  if (head === "RIFF") return "audio/wav";
  if (head === "OggS") return "audio/ogg";
  return "audio/mpeg";
}
