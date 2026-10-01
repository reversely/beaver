// Every server call the interface makes, against one of two backends (#65):
//   laptop  the desktop app's Python server (run.py serve), the default
//   agent   the beaver-agent Worker's session agent, when the page's URL carries ?s=<session>&key=<key>
// The views call these functions and never fetch directly, so one copy of the interface serves
// both. ask() yields the events the laptop's /api/ask stream sends, so the Ask view renders a turn
// the same way on either backend.
import { redact } from "./guard.js";

const params = new URLSearchParams(location.search);
// The laptop's server listens on 127.0.0.1 only (server.py), as the site menu assumes (/nav.js).
const ON_LAPTOP = ["127.0.0.1", "localhost"].includes(location.hostname);
const SAVED = "beaver-session";

function savedLink() {
  try {
    return JSON.parse(localStorage.getItem(SAVED) ?? "null");
  } catch {
    return null;
  }
}

// A session link opened once on this browser is kept, so /app/ alone reopens that session; the
// URL then shows the link again so it can be copied.
let session = params.get("s") ?? "";
let key = params.get("key") ?? "";
if (session && key) {
  try {
    localStorage.setItem(SAVED, JSON.stringify({ session, key }));
  } catch {}
} else if (!ON_LAPTOP) {
  const saved = savedLink();
  if (saved?.session && saved?.key) {
    ({ session, key } = saved);
    const url = new URL(location.href);
    url.searchParams.set("s", session);
    url.searchParams.set("key", key);
    history.replaceState(null, "", url);
  }
}

/** "agent" on the Cloudflare page, "laptop" on the desktop app, "none" on the Cloudflare page
 * opened without a session link, where no backend can answer. */
export const BACKEND = session && key ? "agent" : ON_LAPTOP ? "laptop" : "none";
const AGENT_BASE = `/agents/beaver-guide/${encodeURIComponent(session)}`;
// MeloTTS's languages (agent/src/workers-ai.ts); other sentences show without audio.
const AGENT_SPOKEN = new Set(["en", "es", "fr", "zh"]);

// Elements marked data-backend="laptop" or "agent" show only on that backend. The site menu
// (/nav.js) runs after this module and reads data-site, so the Cloudflare page counts as online.
document.querySelectorAll("[data-backend]").forEach((el) => (el.hidden = el.dataset.backend !== BACKEND));
if (BACKEND !== "laptop") document.body.dataset.site = "online";
const NO_LINK = "Open Beaver with the session link you were given; this address alone has no session.";

async function agent(path, body) {
  const response = await fetch(`${AGENT_BASE}/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "X-Session-Key": key, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error ?? `Request failed (${response.status})`);
  }
  return response;
}

// ---- Settings: the laptop's shape, { section: { key: value } } --------------------------------

let agentSettings = null;

function fromAgent(settings) {
  agentSettings = settings;
  return { languages: settings.languages, answer: { mode: settings.mode } };
}

export async function getSettings() {
  if (BACKEND === "none") return {};
  if (BACKEND === "laptop") return (await fetch("/api/settings")).json();
  // The settings live in the agent's state; this reads them once, and the state socket keeps them.
  const state = await nextState();
  return fromAgent(state.settings);
}

/** Save one setting; returns every setting, or throws with the server's message. */
export async function saveSetting(section, name, value) {
  if (BACKEND === "none") throw new Error(NO_LINK);
  if (BACKEND === "laptop") {
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [section]: { [name]: value } }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    return body;
  }
  const next = structuredClone(agentSettings);
  if (section === "languages") next.languages[name] = value;
  else if (section === "answer" && name === "mode") next.mode = value;
  return fromAgent(await (await agent("settings", next)).json());
}

// ---- Place: the province and municipality from the rover's phone (laptop only) ---------------

export async function getPlace() {
  if (BACKEND !== "laptop") return {};
  return fetch("/api/place").then((r) => r.json()).catch(() => ({}));
}

// ---- Notebooks ----------------------------------------------------------------------------

export async function getNotebooks() {
  if (BACKEND === "none") return [];
  const response = BACKEND === "laptop" ? await fetch("/api/notebooks") : await agent("notebooks");
  return response.ok ? response.json() : null;
}

/** One notebook, or null when it cannot be found. */
export async function getNotebook(id) {
  if (BACKEND === "none") return null;
  try {
    const path = `notebooks/${encodeURIComponent(id)}`;
    const response = BACKEND === "laptop" ? await fetch(`/api/${path}`) : await agent(path);
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

// ---- Live session and review --------------------------------------------------------------

/** { link, qr_svg?, socket, note? } for the session card, or { link: null } without one. */
export async function getSession() {
  if (BACKEND === "none") return { link: null };
  if (BACKEND === "laptop") return (await fetch("/api/session")).json();
  const { key: viewer } = await (await agent("viewer")).json();
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return {
    link: `${location.origin}/session.html?s=${encodeURIComponent(session)}&key=${viewer}`,
    socket: `${scheme}://${location.host}${AGENT_BASE}?key=${encodeURIComponent(key)}`,
  };
}

export async function review(id, remembered) {
  if (BACKEND === "none") throw new Error(NO_LINK);
  if (BACKEND === "agent") return agent("review", { id, remembered });
  const response = await fetch("/api/review", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Beaver": "1" },
    body: JSON.stringify({ id, remembered }),
  });
  if (!response.ok) throw new Error("The review could not be saved");
}

/** The agent's next state message, read once over its socket (for the first settings). */
function nextState() {
  return new Promise((resolve, reject) => {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${scheme}://${location.host}${AGENT_BASE}?key=${encodeURIComponent(key)}`);
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type !== "cf_agent_state") return;
        socket.close();
        resolve(message.state);
      } catch {}
    });
    socket.addEventListener("error", () => reject(new Error("The session could not be reached")));
  });
}

// ---- Asking -----------------------------------------------------------------------------------

/** Events for one question, as the laptop's /api/ask streams them: question, sentence (with an
 * audio URL or null), notebook, done, error. `payload` holds `text` or `audio` ({ chunks, rate }
 * of Float32 samples), and `image_jpeg` when the camera is on. `options.language` is the spoken
 * language for in-browser Whisper; `options.status` reports progress. */
export async function* ask(payload, options = {}) {
  if (BACKEND === "none") yield { type: "error", message: NO_LINK };
  else if (BACKEND === "laptop") yield* askLaptop(payload);
  else yield* askAgent(payload, options);
}

async function* askLaptop(payload) {
  const body = { ...payload };
  if (payload.audio) {
    body.audio_wav = encodeWav(payload.audio.chunks, payload.audio.rate);
    delete body.audio;
  }
  const response = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop();
    for (const line of lines) if (line.trim()) yield JSON.parse(line);
  }
}

async function* askAgent(payload, { language = "en", status = () => {} }) {
  const started = performance.now();
  let heard = payload.text ?? "";
  if (payload.audio) {
    const { transcribe, to16k } = await import("./whisper.js");
    status("transcribing on this device");
    const { chunks, rate } = payload.audio;
    const samples = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of chunks) {
      samples.set(c, at);
      at += c.length;
    }
    heard = await transcribe(to16k(samples, rate), language, (fraction) =>
      status(`loading the speech model on this device: ${Math.round(fraction * 100)}%`),
    );
    status("thinking");
  }
  // The guard proxy, here in the browser, before the question leaves the device.
  const question = redact(heard.trim()).text;
  if (!question) {
    yield { type: "error", message: "Beaver did not catch that. Please ask again." };
    return;
  }
  const result = await (
    await agent("turn", { question, ...(payload.image_jpeg ? { image_jpeg: payload.image_jpeg } : {}) })
  ).json();
  const textReady = Math.round(performance.now() - started);
  // And again on every sentence before it is shown, published, or spoken.
  const groups = result.groups.map((g) => g.map(([code, text]) => [code, redact(text).text]));
  yield { type: "question", question, visitor: result.visitor, codes: result.codes };
  const sentences = groups.flatMap((g, group) => g.map(([code, text]) => ({ group, code, text })));
  // The agent files the published turn into a notebook after this request returns.
  const published = agent("publish", {
    question,
    visitor: { name: result.visitor.name, code: result.visitor.code },
    sentences,
    file: true,
  }).catch(() => null);
  // Two sentences synthesize at once, as tts.parallel does on the laptop; each is yielded in
  // speaking order as soon as it and every sentence before it are ready.
  const limit = twoAtOnce();
  const clips = sentences.map((s) =>
    AGENT_SPOKEN.has(s.code)
      ? limit(() =>
          agent("speak", { text: s.text, lang: s.code })
            .then((r) => r.blob())
            .then((blob) => URL.createObjectURL(blob))
            .catch(() => null),
        )
      : Promise.resolve(null),
  );
  let firstAudio = null;
  for (let i = 0; i < sentences.length; i++) {
    const audio = await clips[i];
    firstAudio ??= audio ? Math.round(performance.now() - started) : null;
    yield { type: "sentence", ...sentences[i], audio };
  }
  await published;
  yield { type: "notebook_pending" };
  yield {
    type: "done",
    timings_ms: { ...result.timings_ms, text_ready: textReady, first_audio_ready: firstAudio, all_synthesized: Math.round(performance.now() - started) },
  };
}

/** A runner that starts at most two tasks at once, in the order they were handed over. */
function twoAtOnce() {
  let running = 0;
  const waiting = [];
  const pump = () => {
    while (running < 2 && waiting.length) {
      const [task, resolve] = waiting.shift();
      running++;
      task()
        .then(resolve)
        .finally(() => {
          running--;
          pump();
        });
    }
  };
  return (task) =>
    new Promise((resolve) => {
      waiting.push([task, resolve]);
      pump();
    });
}

/** 16-bit mono WAV, base64, from Float32 chunks: what the laptop's server takes. */
function encodeWav(chunks, rate) {
  const length = chunks.reduce((n, c) => n + c.length, 0);
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const text = (offset, s) => [...s].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, length * 2, true);
  let offset = 44;
  for (const chunk of chunks) {
    for (const sample of chunk) {
      view.setInt16(offset, Math.max(-1, Math.min(1, sample)) * 0x7fff, true);
      offset += 2;
    }
  }
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// ---- Cloudflare voice call (agent only) -------------------------------------------------------

/** Start or end a call through the agent's voice pipeline; `status(text)` reports each step. */
export function voiceCall(status) {
  let client = null;
  let inCall = false;
  const LABELS = {
    idle: "press Start call and speak; Beaver answers when you pause",
    listening: "listening",
    thinking: "thinking",
    speaking: "speaking",
  };
  return {
    get inCall() {
      return inCall;
    },
    async toggle() {
      if (inCall) {
        client.endCall();
        inCall = false;
        status("call ended");
        return false;
      }
      if (!client) {
        const { VoiceClient } = await import("./voice-client.js");
        client = new VoiceClient({ agent: "beaver-guide", name: session, query: { key } });
        client.addEventListener("statuschange", (s) => status(LABELS[s] ?? s));
        client.addEventListener("error", (e) => e && status(String(e), true));
        // startCall refuses to run before the socket is open.
        const open = new Promise((resolve) => {
          const ready = (up) => up && (client.removeEventListener("connectionchange", ready), resolve());
          client.addEventListener("connectionchange", ready);
        });
        client.connect();
        status("connecting the call");
        await open;
      }
      await client.startCall();
      if (client.error) throw new Error(client.error);
      inCall = true;
      return true;
    },
  };
}
