// The beaver-agent Worker: one BeaverGuide agent per desktop session. The laptop transcribes and
// guards each question, then asks the agent to answer, translate, and speak with Workers AI.
//   POST /agents/beaver-guide/<session>/ask        rendered prompts and parts -> reply text
//   POST /agents/beaver-guide/<session>/translate  sentences and target codes -> translations
//   POST /agents/beaver-guide/<session>/speak      one guarded sentence -> WAV or MP3
//   POST /agents/beaver-guide/<session>/publish    one guarded turn -> the session's state, and
//                                                  with `notebook`, a queued filing (#62)
//   GET  /agents/beaver-guide/<session>/notebooks[/<id>]  the session's notebooks (#62)
//   POST /agents/beaver-guide/<session>/review     a due word remembered or forgotten (#63)
// Viewers (session.html) open a read-only WebSocket on /agents/beaver-guide/<session>?key=<key>
// and receive the state each time it changes.

import { Agent, type Connection, routeAgentRequest } from "agents";
import { hasToken, sameText, viewerKey } from "./auth.ts";
import {
  checkFiling,
  type FilingRequest,
  listing,
  newId,
  type NotebookRow,
} from "./notebooks.ts";
import {
  addDue,
  type DueWord,
  firstInterval,
  nextInterval,
  removeDue,
} from "./reviews.ts";
import { addTurn, checkTurn, type Turn } from "./turns.ts";
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
  BEAVER_AGENT_TOKEN: string;
  ANSWER_MODEL: string;
  TRANSLATE_MODEL: string;
  SPEECH_MODEL: string;
}

// A camera frame from the desktop app is under 1 MB as JPEG; base64 adds a third.
const MAX_BODY_BYTES = 4 * 1024 * 1024;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

async function readJson<T>(request: Request): Promise<T> {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > MAX_BODY_BYTES) throw new RangeError("Request body is too large");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new RangeError("Request body is too large");
  return JSON.parse(text) as T;
}

export interface State {
  turns: Turn[];
  // Notebook words whose review has fallen due (#63), shown on every screen.
  reviews_due: DueWord[];
}

interface ReviewRow extends DueWord {
  interval_seconds: number;
  first_seconds: number;
}

export class BeaverGuide extends Agent<Env, State> {
  initialState: State = { turns: [], reviews_due: [] };

  /** Every WebSocket client is a viewer: it receives state and can never change it. */
  onConnect(connection: Connection) {
    this.setConnectionReadonly(connection, true);
  }

  onMessage() {}

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
    if (request.method !== "POST") return json({ error: "Use POST" }, 405);
    try {
      if (action === "ask") return await this.ask(await readJson<AskRequest>(request));
      if (action === "translate") return await this.translate(await readJson(request));
      if (action === "speak") return await this.speak(await readJson(request));
      if (action === "publish") return await this.publish(await readJson(request));
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
    const output = await this.env.AI.run(this.env.ANSWER_MODEL as never, chatInput(ask) as never);
    const text = replyText(output);
    if (!text) return json({ error: "Workers AI returned no text" }, 502);
    return json({ text, usage: usage(output), model: this.env.ANSWER_MODEL, ms: Date.now() - start });
  }

  async translate(body: { sentences: string[]; source: string; targets: string[] }) {
    const start = Date.now();
    const jobs = translationJobs(body.sentences, body.targets);
    const texts = await Promise.all(
      jobs.map(async (job) => {
        const output = (await this.env.AI.run(this.env.TRANSLATE_MODEL as never, {
          text: job.text,
          source_lang: body.source,
          target_lang: job.target,
        } as never)) as { translated_text?: string };
        return (output.translated_text ?? "").trim();
      }),
    );
    return json({
      translations: collectTranslations(jobs, texts, body.sentences.length),
      ms: Date.now() - start,
    });
  }

  async publish(body: unknown): Promise<Response> {
    const turn = checkTurn(body);
    this.setState({ ...this.state, turns: addTurn(this.state.turns, turn) });
    const filing = (body as { notebook?: FilingRequest }).notebook;
    // Queued, so filing finishes in the agent even when the laptop closes the page, and retries
    // on a Workers AI error.
    const queued = filing ? await this.queue("fileTurn", { turn, filing }) : null;
    return json({ turns: this.state.turns.length, filing: queued });
  }

  /** File one published turn into a notebook: the queued task behind publish (#62). */
  async fileTurn({ turn, filing }: { turn: Turn; filing: FilingRequest }) {
    const prompt = filing.prompt.replace("${notebooks}", listing(this.notebookSummaries()));
    const output = await this.env.AI.run(
      this.env.ANSWER_MODEL as never,
      chatInput({ system: "", instruction: prompt, parts: [], schema: filing.schema }) as never,
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

  /** One notebook in the shape notebooks.json holds, so ui/notebooks.js renders it unchanged. */
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

  async speak(body: { text: string; lang: string }): Promise<Response> {
    if (!MELOTTS_LANGUAGES.has(body.lang)) {
      return json({ error: `MeloTTS does not speak ${body.lang}` }, 422);
    }
    const start = Date.now();
    const output = await this.env.AI.run(this.env.SPEECH_MODEL as never, {
      prompt: body.text,
      lang: body.lang,
    } as never);
    const audio = await audioBytes(output);
    return new Response(audio, {
      headers: { "Content-Type": audioType(audio), "X-Synth-Ms": String(Date.now() - start) },
    });
  }
}

/** A WebSocket request whose `key` matches its session's viewer key. */
async function isViewer(request: Request, env: Env): Promise<boolean> {
  if (!env.BEAVER_AGENT_TOKEN) return false;
  const url = new URL(request.url);
  const session = url.pathname.split("/")[3];
  const key = url.searchParams.get("key") ?? "";
  return Boolean(session) && sameText(key, await viewerKey(env.BEAVER_AGENT_TOKEN, session));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.headers.get("Upgrade") === "websocket") {
      if (!(await isViewer(request, env))) return json({ error: "Wrong viewer key" }, 401);
    } else if (!hasToken(request, env.BEAVER_AGENT_TOKEN)) {
      return json({ error: "Missing or wrong token" }, 401);
    }
    return (await routeAgentRequest(request, env)) ?? json({ error: "Not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
