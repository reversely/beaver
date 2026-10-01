// BeaverGuide: one agent per session. It answers, translates, and speaks with Workers AI, keeps
// the session's live turns, notebooks, and review schedule, and runs the voice pipeline (#64).
//
// HTTP actions, under /agents/beaver-guide/<session>/:
//   POST ask        rendered prompts and parts -> reply text (desktop app, #60)
//   POST translate  sentences and target codes -> translations (desktop app, #60)
//   POST turn       a guarded question -> the answer in every spoken language (page, #64)
//   POST speak      one guarded sentence -> WAV
//   POST publish    one guarded turn -> the session's state, and a queued notebook filing (#61, #62)
//   POST settings   the page's language and translation settings (#64)
//   GET  notebooks[/<id>]  the session's notebooks (#62)
//   GET  viewer     the session's watch-only key, for the page's share link (#64)
//   POST review     a due word remembered or forgotten (#63)
// WebSocket clients receive the state on every change. A member (app link) can also start a voice
// call; a viewer (viewer link) only watches.

import { Agent, type Connection, type ConnectionContext } from "agents";
import { type TextSource, type Transcriber, type TranscriberSession, type TranscriberSessionOptions, withVoice } from "agents/voice";
import { PIECES } from "../../src/beaver/desktop/ui/artifact-specs.js";
import { redact } from "../../src/beaver/desktop/ui/guard.js";
import { type Role, roleFor, viewerKey } from "./auth.ts";
import { checkFiling, type FilingRequest, listing, newId, type NotebookRow } from "./notebooks.ts";
import { ANSWER, NOTEBOOK_PROMPT, NOTEBOOKS, PROMPT_VARS, PROMPTS, REVIEW } from "./prompts.ts";
import { render } from "./render.ts";
import { addDue, type DueWord, firstInterval, nextInterval, removeDue } from "./reviews.ts";
import { DEFAULT_LANGUAGES, type LanguageSettings } from "./sentences.ts";
import { answerTurn, type TurnConfig, type TurnResult } from "./turn.ts";
import { type Span, span } from "./trace.ts";
import { addTurn, checkTurn, type Turn } from "./turns.ts";
import { base64, UtteranceCutter, wav } from "./utterances.ts";
import { joinWavs, splitTagged, tagged } from "./voice-text.ts";
import {
  type AskRequest,
  audioBytes,
  audioType,
  chatInput,
  collectTranslations,
  MELOTTS_LANGUAGES,
  replyText,
  translationJobs,
  usage,
} from "./workers-ai.ts";

export interface Env {
  AI: Ai;
  BeaverGuide: DurableObjectNamespace;
  MODELS: R2Bucket;
  BEAVER_AGENT_TOKEN: string;
  ANSWER_MODEL: string;
  TRANSLATE_MODEL: string;
  SPEECH_MODEL: string;
  TRANSCRIBE_MODEL: string;
}

// A camera frame is under 1 MB as JPEG; base64 adds a third.
const MAX_BODY_BYTES = 4 * 1024 * 1024;
// From notebooks.py THEMES; the pieces come from ui/artifact-specs.js itself.
const THEMES = ["civic", "history", "culture", "language"];

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

async function readJson<T>(request: Request): Promise<T> {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > MAX_BODY_BYTES) throw new RangeError("Request body is too large");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new RangeError("Request body is too large");
  return JSON.parse(text) as T;
}

export interface Settings {
  languages: LanguageSettings;
  mode: "translate" | "inline";
}

export interface State {
  turns: Turn[];
  // Notebook words whose review has fallen due (#63), shown on every screen.
  reviews_due: DueWord[];
  settings: Settings;
}

interface ReviewRow extends DueWord {
  interval_seconds: number;
  first_seconds: number;
}

const DEFAULT_SETTINGS: Settings = { languages: DEFAULT_LANGUAGES, mode: "translate" };

/** Settings from the page, checked field by field. */
export function checkSettings(value: unknown): Settings {
  const raw = value as { languages?: Record<string, unknown>; mode?: unknown } | null;
  const l = raw?.languages ?? {};
  const pick = <T>(v: unknown, allowed: readonly T[]) => {
    if (!allowed.includes(v as T)) throw new TypeError("Bad setting");
    return v as T;
  };
  return {
    languages: {
      official: pick(l.official, ["en", "fr", "both"] as const),
      include_visitor_language: pick(l.include_visitor_language, [true, false] as const),
      order: pick(l.order, ["official_first", "visitor_first"] as const),
    },
    mode: pick(raw?.mode, ["translate", "inline"] as const),
  };
}

const NOTEBOOK_SCHEMA = {
  type: "object",
  properties: {
    notebook: {
      type: "object",
      properties: {
        id: { type: "string", description: "An existing id, or empty for new" },
        title_en: { type: "string" },
        title_fr: { type: "string" },
        theme: { type: "string", enum: THEMES },
        artifact: { type: "string", enum: PIECES },
        year_start: { type: "integer" },
        year_end: { type: "integer" },
      },
      required: ["id", "title_en", "title_fr", "theme", "artifact", "year_start", "year_end"],
    },
    vocabulary: {
      type: "array",
      items: {
        type: "object",
        properties: { en: { type: "string" }, fr: { type: "string" }, visitor: { type: "string" }, meaning: { type: "string" } },
        required: ["en", "fr", "visitor", "meaning"],
      },
    },
    concepts: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, summary: { type: "string" }, why_it_matters: { type: "string" } },
        required: ["title", "summary", "why_it_matters"],
      },
    },
    moments: {
      type: "array",
      items: { type: "object", properties: { year: { type: "integer" }, event: { type: "string" } }, required: ["year", "event"] },
    },
  },
  required: ["notebook", "vocabulary", "concepts", "moments"],
};

/** The turn's sentences with the guard applied to each, and the rules that fired. */
export function guardTurn(result: TurnResult): { result: TurnResult; rules: string[] } {
  const rules: string[] = [];
  const groups = result.groups.map((g) =>
    g.map(([code, text]) => {
      const r = redact(text);
      rules.push(...r.rules);
      return [code, r.text] as [string, string];
    }),
  );
  return { result: { ...result, groups }, rules };
}

const VoiceAgent = withVoice(Agent, { audioFormat: "wav" });

export class BeaverGuide extends VoiceAgent<Env, State> {
  initialState: State = { turns: [], reviews_due: [], settings: DEFAULT_SETTINGS };

  // The voice pipeline's last transcription and guard result, for that turn's trace (#67).
  lastHeard: { ms: number; seconds: number; language: string } | null = null;
  lastGuard: { rules: string[]; text: string } | null = null;

  // The voice pipeline's speech-to-text: utterances cut at silence, each sent to Whisper.
  transcriber: Transcriber = {
    createSession: (options?: TranscriberSessionOptions) => this.whisperSession(options),
  };

  // The voice pipeline's speech: each chunk carries language tags (voice-text.ts), so one
  // provider speaks every language MeloTTS has.
  tts = {
    synthesize: async (text: string): Promise<ArrayBuffer | null> => {
      const parts = splitTagged(text).filter((p) => MELOTTS_LANGUAGES.has(p.code) && p.text.trim());
      const clips = await Promise.all(parts.map((p) => this.melo(p.text, p.code)));
      return clips.length ? joinWavs(clips).buffer as ArrayBuffer : null;
    },
  };

  get settings(): Settings {
    return this.state.settings ?? DEFAULT_SETTINGS;
  }

  turnConfig(): TurnConfig {
    return {
      prompts: PROMPTS,
      vars: PROMPT_VARS,
      max_characters: Number(ANSWER.max_characters ?? 280),
      answer_model: this.env.ANSWER_MODEL,
      translate_model: this.env.TRANSLATE_MODEL,
    };
  }

  run = (model: string, input: Record<string, unknown>) =>
    this.env.AI.run(model as never, input as never) as Promise<unknown>;

  /** The key decides whether a WebSocket client may start a voice call. */
  async onConnect(connection: Connection, ctx: ConnectionContext) {
    const url = new URL(ctx.request.url);
    const role = await roleFor(this.env.BEAVER_AGENT_TOKEN, this.name, url.searchParams.get("key") ?? "");
    connection.setState({ role });
  }

  /** Every WebSocket client receives state and can never change it; only the agent's own code
   * does. Marking connections read-only would also block setState in a voice turn, which runs on
   * the caller's connection. */
  validateStateChange(_next: State, source: Connection | "server") {
    if (source !== "server") throw new Error("Clients cannot change the session's state");
  }

  onMessage() {}

  beforeCallStart(connection: Connection): boolean {
    return (connection.state as { role?: Role } | null)?.role === "member";
  }

  /** The guard proxy on the voice transcript, before the answer model sees it. */
  afterTranscribe(transcript: string): string | null {
    const guarded = redact(transcript.trim());
    this.lastGuard = { rules: guarded.rules, text: guarded.text };
    return guarded.text || null;
  }

  /** The guard again on every chunk about to be spoken. */
  beforeSynthesize(text: string): string | null {
    return redact(text).text;
  }

  async onTurn(transcript: string): Promise<TextSource> {
    const started = Date.now();
    const answered = await answerTurn(this.run, this.turnConfig(), { question: transcript, ...this.settings });
    const { result, rules } = guardTurn(answered);
    const heard = this.lastHeard;
    const guard = this.lastGuard;
    const trace: Span[] = [
      span("Stream the microphone", "browser", null, [["Audio", "16 kHz PCM over the session's WebSocket"]]),
      span("Cut the utterance at silence", "agent", null, [["Rule", "800 ms of silence ends it"]]),
      span("Transcribe", "workers-ai", heard?.ms ?? null, [
        ["Model", this.env.TRANSCRIBE_MODEL],
        ["Audio", heard ? `${heard.seconds.toFixed(1)} s` : "unknown"],
        ["Language", heard?.language || "detected by the model"],
      ]),
      span(
        "Guard the question",
        "agent",
        null,
        [["Rules fired", guard?.rules.length ? guard.rules.join(", ") : "none"]],
        guard?.text,
      ),
      span("Session agent", "agent", Date.now() - started, [["Durable Object", `BeaverGuide "${this.name}"`]]),
      ...answered.trace,
      span("Guard every sentence", "agent", null, [["Rules fired", rules.length ? rules.join(", ") : "none"]]),
    ];
    // The turn is shown at once; its trace follows once the filing is queued, complete.
    const turn = this.recordTurn(result);
    const filing = await this.queueFiling(turn, result);
    trace.push(
      span("Publish and file", "agent", null, [
        ["State", `turn sent to ${[...this.getConnections()].length} open screen(s)`],
        ["Notebook filing", `queued task ${filing}`],
      ]),
      span("Speak", "workers-ai", null, [
        ["Model", this.env.SPEECH_MODEL],
        ["How", "each chunk of the streamed reply, split by language tag"],
      ]),
    );
    // The state holds a copy of the turn, so it is found by its time and question.
    const same = (t: Turn) => t.at === turn.at && t.question === turn.question;
    this.setState({ ...this.state, turns: this.state.turns.map((t) => (same(t) ? { ...t, trace } : t)) });
    return tagged(result.groups);
  }

  async onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS notebooks (
      id TEXT PRIMARY KEY, title_en TEXT, title_fr TEXT, theme TEXT, artifact TEXT,
      year_start INTEGER, year_end INTEGER)`;
    this.sql`CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, notebook_id TEXT, at TEXT, question TEXT,
      visitor TEXT, answer TEXT, vocabulary TEXT, concepts TEXT, moments TEXT)`;
    this.sql`CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, notebook_id TEXT, en TEXT, fr TEXT, visitor TEXT,
      meaning TEXT, interval_seconds INTEGER, first_seconds INTEGER)`;
  }

  async onRequest(request: Request): Promise<Response> {
    const parts = new URL(request.url).pathname.split("/");
    // /agents/beaver-guide/<session>/<action>[/<id>]
    const [action, id] = parts.slice(4);
    if (request.method === "GET" && action === "notebooks") {
      return id === undefined ? json(this.notebookSummaries()) : this.notebook(id);
    }
    if (request.method === "GET" && action === "viewer") {
      // A member's page shares a watch-only link without ever holding the token.
      return json({ key: await viewerKey(this.env.BEAVER_AGENT_TOKEN, this.name) });
    }
    if (request.method !== "POST") return json({ error: "Use POST" }, 405);
    try {
      if (action === "ask") return await this.ask(await readJson<AskRequest>(request));
      if (action === "translate") return await this.translate(await readJson(request));
      if (action === "turn") return await this.turn(await readJson(request));
      if (action === "speak") return await this.speakAction(await readJson(request));
      if (action === "publish") return await this.publish(await readJson(request));
      if (action === "settings") return this.saveSettings(await readJson(request));
      if (action === "review") return await this.review(await readJson(request));
      return json({ error: `Unknown action ${action}` }, 404);
    } catch (error) {
      const status =
        error instanceof RangeError
          ? 413
          : error instanceof SyntaxError || error instanceof TypeError
            ? 400
            : 502;
      // The message names the failure; it never carries question or answer text.
      return json({ error: error instanceof Error ? error.message : String(error) }, status);
    }
  }

  async ask(ask: AskRequest): Promise<Response> {
    const start = Date.now();
    const output = await this.run(this.env.ANSWER_MODEL, chatInput(ask));
    const text = replyText(output);
    if (!text) return json({ error: "Workers AI returned no text" }, 502);
    return json({ text, usage: usage(output), model: this.env.ANSWER_MODEL, ms: Date.now() - start });
  }

  async translate(body: { sentences: string[]; source: string; targets: string[] }) {
    const start = Date.now();
    const jobs = translationJobs(body.sentences, body.targets);
    const texts = await Promise.all(
      jobs.map(async (job) => {
        const output = (await this.run(this.env.TRANSLATE_MODEL, {
          text: job.text,
          source_lang: body.source,
          target_lang: job.target,
        })) as { translated_text?: string };
        return (output.translated_text ?? "").trim();
      }),
    );
    return json({ translations: collectTranslations(jobs, texts, body.sentences.length), ms: Date.now() - start });
  }

  /** The page's turn: the question arrives guarded by the browser, and the answer goes back for
   * the browser to guard before it publishes and speaks it. */
  async turn(body: { question?: unknown; image_jpeg?: unknown }): Promise<Response> {
    if (typeof body.question !== "string" || !body.question.trim() || body.question.length > 2000) {
      throw new TypeError("A turn needs a question of up to 2,000 characters");
    }
    if (body.image_jpeg !== undefined && typeof body.image_jpeg !== "string") {
      throw new TypeError("image_jpeg must be base64 text");
    }
    const started = Date.now();
    const result = await answerTurn(this.run, this.turnConfig(), {
      question: body.question,
      image_jpeg: body.image_jpeg as string | undefined,
      ...this.settings,
    });
    const settings = this.settings;
    const agentSpan = span("Session agent", "agent", Date.now() - started, [
      ["Durable Object", `BeaverGuide "${this.name}"`],
      ["Settings", `reply in ${settings.languages.official}, ${settings.mode === "inline" ? "translated in the answer" : "translated by m2m100"}`],
    ]);
    return json({ ...result, trace: [agentSpan, ...result.trace] });
  }

  saveSettings(body: unknown): Response {
    const settings = checkSettings(body);
    this.setState({ ...this.state, settings });
    return json(settings);
  }

  /** Add a guarded turn to the state, which every connected screen receives. */
  recordTurn(result: TurnResult, trace?: Span[]): Turn {
    const checked = checkTurn({
      question: result.question,
      visitor: { name: result.visitor.name, code: result.visitor.code },
      sentences: result.groups.flatMap((g, group) => g.map(([code, text]) => ({ group, code, text }))),
    });
    // The trace comes from the agent itself, so it skips checkTurn, which keeps a client's fields only.
    const turn = trace ? { ...checked, trace } : checked;
    this.setState({ ...this.state, turns: addTurn(this.state.turns ?? [], turn) });
    return turn;
  }

  /** Queue a notebook filing for a turn the page or the voice pipeline made, with the repo's
   * notebook prompt filled here rather than on a laptop. */
  queueFiling(turn: Turn, result: TurnResult) {
    const source = result.codes[0];
    const answer = result.groups.map((g) => g.find(([c]) => c === source)?.[1] ?? "").join(" ");
    const filing: FilingRequest = {
      prompt: render(NOTEBOOK_PROMPT, {
        ...PROMPT_VARS,
        max_vocabulary: NOTEBOOKS.max_vocabulary ?? 4,
        max_concepts: NOTEBOOKS.max_concepts ?? 2,
        visitor_language: turn.visitor.name,
        notebooks: "${notebooks}",
        question: turn.question,
        answer,
      }),
      schema: NOTEBOOK_SCHEMA,
      pieces: PIECES,
      themes: THEMES,
      max_vocabulary: Number(NOTEBOOKS.max_vocabulary ?? 4),
      max_concepts: Number(NOTEBOOKS.max_concepts ?? 2),
      answer,
      review_first_seconds: Number(REVIEW.first_interval_seconds ?? 600),
    };
    return this.queue("fileTurn", { turn, filing });
  }

  async publish(body: unknown): Promise<Response> {
    const turn = checkTurn(body);
    this.setState({ ...this.state, turns: addTurn(this.state.turns ?? [], turn) });
    const raw = body as { notebook?: FilingRequest; file?: boolean; codes?: string[] };
    let queued: string | null = null;
    if (raw.notebook) {
      // The desktop app sends its own filing request (#62).
      queued = await this.queue("fileTurn", { turn, filing: raw.notebook });
    } else if (raw.file === true) {
      // The page asks the agent to file with the repo's prompt (#64).
      const groups = new Map<number, [string, string][]>();
      for (const s of turn.sentences) {
        if (!groups.has(s.group)) groups.set(s.group, []);
        groups.get(s.group)!.push([s.code, s.text]);
      }
      const codes = turn.sentences.filter((s) => s.group === 0).map((s) => s.code);
      queued = await this.queueFiling(turn, {
        question: turn.question,
        visitor: { ...turn.visitor, tag: turn.visitor.code },
        codes,
        groups: [...groups.values()],
        timings_ms: {},
        trace: [],
      });
    }
    return json({
      turns: this.state.turns.length,
      filing: queued,
      // How many screens the state change reached, for the demo mode's panel (#67).
      screens: [...this.getConnections()].length,
    });
  }

  /** File one published turn into a notebook: the queued task behind publish (#62). */
  async fileTurn({ turn, filing }: { turn: Turn; filing: FilingRequest }) {
    const prompt = filing.prompt.replace("${notebooks}", listing(this.notebookSummaries()));
    const output = await this.run(
      this.env.ANSWER_MODEL,
      chatInput({ system: "", instruction: prompt, parts: [], schema: filing.schema }),
    );
    const result = checkFiling(JSON.parse(replyText(output)), filing);
    const chosen = result.notebook;
    const years = result.moments.map((m) => m.year);
    const [existing] = this.sql<NotebookRow>`SELECT * FROM notebooks WHERE id = ${chosen.id}`;
    const id = existing ? existing.id : newId();
    if (existing) {
      this.sql`UPDATE notebooks SET
        artifact = COALESCE(artifact, ${chosen.artifact}),
        year_start = MIN(year_start, ${Math.min(existing.year_start, ...years)}),
        year_end = MAX(year_end, ${Math.max(existing.year_end, ...years)})
        WHERE id = ${id}`;
    } else {
      this.sql`INSERT INTO notebooks VALUES (${id}, ${chosen.title_en}, ${chosen.title_fr},
        ${chosen.theme}, ${chosen.artifact}, ${Math.min(chosen.year_start, ...years)},
        ${Math.max(chosen.year_end, ...years)})`;
    }
    this.sql`INSERT INTO entries (notebook_id, at, question, visitor, answer, vocabulary, concepts,
      moments) VALUES (${id}, ${turn.at}, ${turn.question}, ${JSON.stringify(turn.visitor)},
      ${filing.answer.slice(0, 2000)}, ${JSON.stringify(result.vocabulary)},
      ${JSON.stringify(result.concepts)}, ${JSON.stringify(result.moments)})`;
    const first = firstInterval(filing.review_first_seconds);
    for (const word of result.vocabulary) {
      const [row] = this.sql<{ id: number }>`INSERT INTO reviews (notebook_id, en, fr, visitor,
        meaning, interval_seconds, first_seconds) VALUES (${id}, ${word.en}, ${word.fr},
        ${word.visitor}, ${word.meaning}, ${first}, ${first}) RETURNING id`;
      await this.schedule(first, "reviewDue", { id: row.id });
    }
    return id;
  }

  /** The scheduler's callback when a word's review falls due (#63). */
  async reviewDue({ id }: { id: number }) {
    const [row] = this.sql<ReviewRow>`SELECT * FROM reviews WHERE id = ${id}`;
    if (!row) return;
    const word = { id: row.id, en: row.en, fr: row.fr, visitor: row.visitor, meaning: row.meaning };
    this.setState({ ...this.state, reviews_due: addDue(this.state.reviews_due ?? [], word) });
  }

  /** A due word marked remembered or forgotten: schedule its next review and clear it. */
  async review(body: { id?: unknown; remembered?: unknown }): Promise<Response> {
    const due = this.state.reviews_due ?? [];
    if (!Number.isInteger(body.id) || typeof body.remembered !== "boolean") {
      throw new TypeError("A review needs a word id and remembered true or false");
    }
    const id = body.id as number;
    const [row] = this.sql<ReviewRow>`SELECT * FROM reviews WHERE id = ${id}`;
    if (!row || !due.some((w) => w.id === id)) return json({ error: "That word is not due" }, 404);
    const interval = nextInterval(row.interval_seconds, body.remembered, row.first_seconds);
    this.sql`UPDATE reviews SET interval_seconds = ${interval} WHERE id = ${id}`;
    await this.schedule(interval, "reviewDue", { id });
    this.setState({ ...this.state, reviews_due: removeDue(due, id) });
    return json({ next_review_seconds: interval });
  }

  notebookSummaries(): NotebookRow[] {
    return this.sql<NotebookRow>`SELECT n.*, COUNT(e.id) AS entries FROM notebooks n
      LEFT JOIN entries e ON e.notebook_id = n.id GROUP BY n.id ORDER BY MIN(e.id)`;
  }

  /** One notebook in the shape notebooks.json holds, so the notebook views render it unchanged. */
  notebook(id: string): Response {
    const [row] = this.sql<NotebookRow>`SELECT * FROM notebooks WHERE id = ${id}`;
    if (!row) return json({ error: "No such notebook" }, 404);
    const entries = this.sql<Record<string, string>>`SELECT * FROM entries
      WHERE notebook_id = ${id} ORDER BY id`.map((e) => ({
      at: e.at,
      question: e.question,
      visitor_language: JSON.parse(e.visitor),
      answer: e.answer,
      vocabulary: JSON.parse(e.vocabulary),
      concepts: JSON.parse(e.concepts),
      moments: JSON.parse(e.moments),
      source: "desktop",
    }));
    return json({ ...row, entries });
  }

  async melo(text: string, lang: string): Promise<Uint8Array> {
    return audioBytes(await this.run(this.env.SPEECH_MODEL, { prompt: text, lang }));
  }

  /** The `speak` action; named apart from the voice mixin's own speak(connection, text). */
  async speakAction(body: { text: string; lang: string }): Promise<Response> {
    if (!MELOTTS_LANGUAGES.has(body.lang)) {
      return json({ error: `MeloTTS does not speak ${body.lang}` }, 422);
    }
    const start = Date.now();
    const audio = await this.melo(body.text, body.lang);
    return new Response(audio, {
      headers: {
        "Content-Type": audioType(audio),
        "X-Synth-Ms": String(Date.now() - start),
        "X-Model": this.env.SPEECH_MODEL,
      },
    });
  }

  /** One call's transcription session: cut utterances at silence and send each to Whisper. */
  whisperSession(options?: TranscriberSessionOptions): TranscriberSession {
    const cutter = new UtteranceCutter();
    let closed = false;
    const transcribe = async (clip: Int16Array) => {
      try {
        const started = Date.now();
        const output = (await this.run(this.env.TRANSCRIBE_MODEL, {
          audio: base64(wav(clip)),
          ...(options?.language ? { language: options.language } : {}),
        })) as { text?: string; transcription_info?: { language?: string } };
        this.lastHeard = {
          ms: Date.now() - started,
          seconds: clip.length / 16000,
          language: output.transcription_info?.language ?? "",
        };
        const text = (output.text ?? "").trim();
        if (text && !closed) options?.onUtterance?.(text);
      } catch (error) {
        if (!closed) options?.onFatalError?.(error instanceof Error ? error : new Error(String(error)));
      }
    };
    return {
      feed: (chunk: ArrayBuffer) => {
        if (closed) return;
        const clip = cutter.push(new Int16Array(chunk.slice(0, chunk.byteLength - (chunk.byteLength % 2))));
        if (clip) void transcribe(clip);
      },
      close: () => {
        closed = true;
      },
    };
  }
}
