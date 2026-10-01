// The beaver-agent Worker: one BeaverGuide agent per desktop session. The laptop transcribes and
// guards each question, then asks the agent to answer, translate, and speak with Workers AI.
//   POST /agents/beaver-guide/<session>/ask        rendered prompts and parts -> reply text
//   POST /agents/beaver-guide/<session>/translate  sentences and target codes -> translations
//   POST /agents/beaver-guide/<session>/speak      one guarded sentence -> MP3
//   POST /agents/beaver-guide/<session>/publish    one guarded turn -> the session's state
// Viewers (session.html) open a read-only WebSocket on /agents/beaver-guide/<session>?key=<key>
// and receive the state each time it changes.

import { Agent, type Connection, routeAgentRequest } from "agents";
import { hasToken, sameText, viewerKey } from "./auth.ts";
import { addTurn, checkTurn, type Turn } from "./turns.ts";
import {
  type AskRequest,
  audioBytes,
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
}

export class BeaverGuide extends Agent<Env, State> {
  initialState: State = { turns: [] };

  /** Every WebSocket client is a viewer: it receives state and can never change it. */
  onConnect(connection: Connection) {
    this.setConnectionReadonly(connection, true);
  }

  onMessage() {}

  async onRequest(request: Request): Promise<Response> {
    if (request.method !== "POST") return json({ error: "Use POST" }, 405);
    const action = new URL(request.url).pathname.split("/").pop();
    try {
      if (action === "ask") return await this.ask(await readJson<AskRequest>(request));
      if (action === "translate") return await this.translate(await readJson(request));
      if (action === "speak") return await this.speak(await readJson(request));
      if (action === "publish") return this.publish(await readJson(request));
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

  publish(body: unknown): Response {
    const turn = checkTurn(body);
    this.setState({ ...this.state, turns: addTurn(this.state.turns, turn) });
    return json({ turns: this.state.turns.length });
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
      headers: { "Content-Type": "audio/mpeg", "X-Synth-Ms": String(Date.now() - start) },
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
