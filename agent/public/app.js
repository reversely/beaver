// The Beaver page (#64): ask by voice or typing, follow the session's conversation, review due
// words, and browse notebooks, all against this session's agent.
//
// "This device" mode transcribes with Whisper in the browser (whisper.js) and redacts the
// question with the guard proxy (guard.js) before anything is sent; the agent answers and
// translates; the page guards every sentence, publishes the turn, and asks for speech.
// "Cloudflare" mode streams the microphone to the agent's voice pipeline, which transcribes with
// Workers AI and runs the same guard there.
import { redact } from "./guard.js";
import { to16k, transcribe, load as loadWhisper } from "./whisper.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const session = params.get("s") ?? "";
const key = params.get("key") ?? "";
const base = `/agents/beaver-guide/${encodeURIComponent(session)}`;
// MeloTTS's languages; other sentences show without audio (agent/src/workers-ai.ts).
const SPOKEN = new Set(["en", "es", "fr", "zh"]);
const LANGUAGE_NAMES = new Intl.DisplayNames(["en"], { type: "language" });

let state = { turns: [], reviews_due: [], settings: null };
let busy = false;

// ---- Helpers --------------------------------------------------------------------------------

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setStatus(text, isError = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", isError);
}

async function api(path, body) {
  const response = await fetch(`${base}/${path}`, {
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

function languageName(code) {
  try {
    return LANGUAGE_NAMES.of(code);
  } catch {
    return code;
  }
}

// ---- Session state over the agent's WebSocket ------------------------------------------------

let retry = 1000;
function follow() {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${scheme}://${location.host}${base}?key=${encodeURIComponent(key)}`);
  socket.addEventListener("open", () => {
    retry = 1000;
    $("connection").textContent = "Live";
  });
  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type !== "cf_agent_state") return;
    const filed = (message.state.turns ?? []).length !== state.turns.length;
    state = { ...state, ...message.state };
    render();
    // The agent files a turn into a notebook after it publishes it.
    if (filed) setTimeout(showNotebooks, 6000);
  });
  socket.addEventListener("close", () => {
    $("connection").textContent = `Reconnecting in ${retry / 1000} s`;
    setTimeout(follow, retry);
    retry = Math.min(retry * 2, 30000);
  });
}

function render() {
  showSettings();
  showTurns();
  showReview();
}

// ---- Settings ---------------------------------------------------------------------------------

function settingValue(path) {
  return path.split(".").reduce((o, k) => o?.[k], state.settings);
}

function showSettings() {
  if (!state.settings) return;
  document.querySelectorAll(".seg[data-setting]").forEach((group) => {
    const value = String(settingValue(group.dataset.setting));
    group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.value === value)));
  });
}

document.querySelectorAll(".seg[data-setting] button").forEach((button) => {
  button.addEventListener("click", async () => {
    if (!state.settings) return;
    const path = button.closest(".seg").dataset.setting;
    const raw = button.dataset.value;
    const value = raw === "true" ? true : raw === "false" ? false : raw;
    const next = structuredClone(state.settings);
    const keys = path.split(".");
    keys.slice(0, -1).reduce((o, k) => o[k], next)[keys.at(-1)] = value;
    try {
      await api("settings", next);
    } catch (error) {
      setStatus(error.message, true);
    }
  });
});

$("share").addEventListener("click", async () => {
  try {
    const { key: viewer } = await (await api("viewer")).json();
    const link = `${location.origin}/session.html?s=${encodeURIComponent(session)}&key=${viewer}`;
    await navigator.clipboard.writeText(link);
    setStatus("Copied a link that shows this conversation without letting anyone ask.");
  } catch (error) {
    setStatus(`The link could not be copied: ${error.message}`, true);
  }
});

// ---- Conversation -----------------------------------------------------------------------------

function showTurns() {
  const turns = state.turns ?? [];
  $("thread-empty").hidden = turns.length > 0;
  $("turns").replaceChildren(
    ...turns.slice().reverse().map((turn) => {
      const item = element("li", "card turn");
      const question = element("p", "question", turn.question);
      question.dir = "auto";
      item.append(question);
      const groups = new Map();
      for (const s of turn.sentences) {
        if (!groups.has(s.group)) groups.set(s.group, []);
        groups.get(s.group).push(s);
      }
      for (const sentences of groups.values()) {
        const group = element("div", "group");
        for (const s of sentences) {
          const line = element("p", "line");
          line.lang = s.code;
          const text = element("span", "text", s.text);
          text.dir = "auto";
          const code = element("span", "code", s.code);
          code.title = languageName(s.code);
          line.append(code, text);
          group.append(line);
        }
        item.append(group);
      }
      return item;
    }),
  );
}

// ---- Review -----------------------------------------------------------------------------------

function showReview() {
  const words = state.reviews_due ?? [];
  $("review").hidden = words.length === 0;
  $("review-list").replaceChildren(
    ...words.map((word) => {
      const item = element("li", "review-word");
      const words = element("p", "review-words");
      const french = element("span", "review-fr", word.fr);
      french.lang = "fr";
      words.append(element("span", "review-en", word.en), french);
      if (word.visitor && word.visitor !== word.en) {
        const visitor = element("span", "review-visitor", word.visitor);
        visitor.dir = "auto";
        words.append(visitor);
      }
      const actions = element("div", "review-actions");
      for (const [label, remembered, style] of [["Remembered", true, "primary"], ["Forgot", false, "secondary"]]) {
        const button = element("button", style, label);
        button.type = "button";
        button.addEventListener("click", async () => {
          actions.querySelectorAll("button").forEach((b) => (b.disabled = true));
          try {
            await api("review", { id: word.id, remembered });
          } catch (error) {
            setStatus(error.message, true);
            actions.querySelectorAll("button").forEach((b) => (b.disabled = false));
          }
        });
        actions.append(button);
      }
      item.append(words, element("p", "review-meaning", word.meaning), actions);
      return item;
    }),
  );
}

// ---- Notebooks --------------------------------------------------------------------------------

async function showNotebooks() {
  let notebooks;
  try {
    notebooks = await (await api("notebooks")).json();
  } catch {
    return;
  }
  $("notebooks-empty").hidden = notebooks.length > 0;
  $("notebooks").replaceChildren(
    ...notebooks.slice().reverse().map((n) => {
      const item = element("li", "card notebook");
      const details = element("details");
      const summary = element("summary");
      const titles = element("span", "nb-titles");
      const french = element("span", "nb-fr", n.title_fr);
      french.lang = "fr";
      titles.append(element("span", "nb-title", n.title_en), french);
      const plural = n.entries === 1 ? "question" : "questions";
      summary.append(titles, element("span", "nb-meta", `${n.theme}, ${n.year_start} to ${n.year_end}, ${n.entries} ${plural}`));
      details.append(summary);
      details.addEventListener("toggle", () => details.open && fillNotebook(details, n.id), { once: true });
      item.append(details);
      return item;
    }),
  );
}

async function fillNotebook(details, id) {
  const body = element("div", "nb-body", "Loading");
  details.append(body);
  try {
    const notebook = await (await api(`notebooks/${encodeURIComponent(id)}`)).json();
    body.replaceChildren();
    const vocabulary = notebook.entries.flatMap((e) => e.vocabulary);
    const concepts = notebook.entries.flatMap((e) => e.concepts);
    const moments = notebook.entries.flatMap((e) => e.moments).sort((a, b) => a.year - b.year);
    if (vocabulary.length) {
      body.append(element("h3", "", "Vocabulary"));
      const list = element("ul", "nb-list");
      for (const v of vocabulary) {
        const row = element("li");
        const fr = element("span", "nb-fr", v.fr);
        fr.lang = "fr";
        row.append(element("strong", "", v.en), " ", fr, element("span", "nb-meta", v.meaning));
        list.append(row);
      }
      body.append(list);
    }
    if (concepts.length) {
      body.append(element("h3", "", "Concepts"));
      const list = element("ul", "nb-list");
      for (const c of concepts) {
        const row = element("li");
        row.append(element("strong", "", c.title), element("span", "nb-meta", `${c.summary} ${c.why_it_matters}`));
        list.append(row);
      }
      body.append(list);
    }
    if (moments.length) {
      body.append(element("h3", "", "Moments"));
      const list = element("ul", "nb-list");
      for (const m of moments) list.append(element("li", "", `${m.year}: ${m.event}`));
      body.append(list);
    }
  } catch (error) {
    body.textContent = `This notebook could not be loaded: ${error.message}`;
  }
}

// ---- Speech playback --------------------------------------------------------------------------

const playback = [];
let playing = false;

function play(blob) {
  playback.push(blob);
  if (!playing) next();
}

function next() {
  const blob = playback.shift();
  if (!blob) {
    playing = false;
    return;
  }
  playing = true;
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  const done = () => {
    URL.revokeObjectURL(url);
    next();
  };
  audio.addEventListener("ended", done);
  audio.addEventListener("error", done);
  audio.play().catch(done);
}

/** Ask for every spoken sentence two at a time, and play them in order as they arrive. */
async function speakAll(groups) {
  const pieces = groups.flat().filter(([code]) => SPOKEN.has(code));
  const clips = pieces.map(() => null);
  let nextToPlay = 0;
  const flush = () => {
    while (nextToPlay < clips.length && clips[nextToPlay] !== null) {
      if (clips[nextToPlay]) play(clips[nextToPlay]);
      nextToPlay++;
    }
  };
  let at = 0;
  const worker = async () => {
    while (at < pieces.length) {
      const i = at++;
      const [lang, text] = pieces[i];
      try {
        clips[i] = await (await api("speak", { text, lang })).blob();
      } catch {
        clips[i] = false;
      }
      flush();
    }
  };
  await Promise.all([worker(), worker()]);
}

// ---- Asking ---------------------------------------------------------------------------------

/** One turn from a question already transcribed on this device. */
async function ask(heard) {
  const { text: question, rules } = redact(heard.trim());
  if (!question) {
    setStatus("Beaver did not catch that. Please ask again.", true);
    return;
  }
  busy = true;
  $("talk").disabled = true;
  const started = performance.now();
  try {
    setStatus(rules.length ? "Removed personal information, then asking Beaver" : "Asking Beaver");
    const image = cameraFrame();
    const result = await (await api("turn", { question, ...(image ? { image_jpeg: image } : {}) })).json();
    // The guard proxy again on every sentence before it is published or spoken.
    const groups = result.groups.map((g) => g.map(([code, text]) => [code, redact(text).text]));
    const sentences = groups.flatMap((g, group) => g.map(([code, text]) => ({ group, code, text })));
    await api("publish", { question, visitor: { name: result.visitor.name, code: result.visitor.code }, sentences, file: true });
    setStatus(`Answer ready in ${((performance.now() - started) / 1000).toFixed(1)} s`);
    await speakAll(groups);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    busy = false;
    $("talk").disabled = false;
  }
}

$("typed").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = $("typed-input").value;
  if (!text.trim() || busy) return;
  $("typed-input").value = "";
  ask(text);
});

// ---- Camera -----------------------------------------------------------------------------------

let cameraStream = null;
$("camera-toggle").addEventListener("change", async (event) => {
  const view = $("camera-view");
  if (event.target.checked) {
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      view.srcObject = cameraStream;
      view.hidden = false;
      await view.play();
    } catch (error) {
      event.target.checked = false;
      setStatus(`The camera could not start: ${error.message}`, true);
    }
  } else {
    cameraStream?.getTracks().forEach((t) => t.stop());
    cameraStream = null;
    view.hidden = true;
  }
});

/** The camera's current frame as base64 JPEG, at most 1024 px on its long side. */
function cameraFrame() {
  const view = $("camera-view");
  if (!cameraStream || !view.videoWidth) return null;
  const scale = Math.min(1, 1024 / Math.max(view.videoWidth, view.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(view.videoWidth * scale);
  canvas.height = Math.round(view.videoHeight * scale);
  canvas.getContext("2d").drawImage(view, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
}

// ---- Voice: this device -----------------------------------------------------------------------

let recording = null;

async function startRecording() {
  if (busy || recording) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const chunks = [];
    processor.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    source.connect(processor);
    processor.connect(context.destination);
    recording = { stream, context, processor, chunks };
    $("talk").textContent = "Release to ask";
    $("talk").classList.add("live");
    setStatus("Listening");
    // Start the model download while the visitor speaks.
    loadWhisper(progress).catch(() => {});
  } catch (error) {
    setStatus(`The microphone could not start: ${error.message}`, true);
  }
}

function progress(fraction) {
  if (fraction < 1) setStatus(`Loading the speech model on this device: ${Math.round(fraction * 100)}%`);
}

async function stopRecording() {
  if (!recording) return;
  const { stream, context, processor, chunks } = recording;
  recording = null;
  processor.disconnect();
  stream.getTracks().forEach((t) => t.stop());
  await context.close();
  $("talk").textContent = "Hold to talk";
  $("talk").classList.remove("live");
  const length = chunks.reduce((n, c) => n + c.length, 0);
  if (length < context.sampleRate * 0.3) {
    setStatus("Hold the button while you speak.", true);
    return;
  }
  const samples = new Float32Array(length);
  let at = 0;
  for (const c of chunks) {
    samples.set(c, at);
    at += c.length;
  }
  busy = true;
  $("talk").disabled = true;
  try {
    setStatus("Transcribing on this device");
    const started = performance.now();
    const heard = await transcribe(to16k(samples, context.sampleRate), $("language").value, progress);
    console.info(`Whisper in the browser: ${Math.round(performance.now() - started)} ms`);
    busy = false;
    await ask(heard);
  } catch (error) {
    setStatus(`Transcription failed: ${error.message}`, true);
  } finally {
    busy = false;
    $("talk").disabled = false;
  }
}

// ---- Voice: Cloudflare ------------------------------------------------------------------------

let voice = null;
const VOICE_STATUS = {
  idle: "Press Start call and speak; Beaver answers when you pause.",
  listening: "Listening",
  thinking: "Beaver is thinking",
  speaking: "Beaver is speaking",
};

async function toggleCall() {
  if (voice?.inCall) {
    voice.client.endCall();
    voice.inCall = false;
    $("talk").textContent = "Start call";
    $("talk").classList.remove("live");
    setStatus("Call ended");
    return;
  }
  try {
    if (!voice) {
      const { VoiceClient } = await import("./voice-client.js");
      const client = new VoiceClient({ agent: "beaver-guide", name: session, query: { key } });
      client.addEventListener("statuschange", (status) => setStatus(VOICE_STATUS[status] ?? status));
      client.addEventListener("error", (error) => error && setStatus(String(error), true));
      voice = { client, inCall: false };
      // startCall refuses to run before the socket is open.
      const connected = new Promise((resolve) => {
        const ready = (up) => {
          if (!up) return;
          client.removeEventListener("connectionchange", ready);
          resolve();
        };
        client.addEventListener("connectionchange", ready);
      });
      client.connect();
      setStatus("Connecting the call");
      await connected;
    }
    await voice.client.startCall();
    if (voice.client.error) throw new Error(voice.client.error);
    voice.inCall = true;
    $("talk").textContent = "End call";
    $("talk").classList.add("live");
  } catch (error) {
    setStatus(`The call could not start: ${error.message}`, true);
  }
}

// ---- Voice mode switch ------------------------------------------------------------------------

const HINTS = {
  device: "Speech is transcribed on this device; the first use downloads a 77 MB model.",
  cloudflare: "Speech streams to Cloudflare, which transcribes it and removes personal information there.",
};
let voiceMode = "device";
try {
  voiceMode = localStorage.getItem("beaver-voice") === "cloudflare" ? "cloudflare" : "device";
} catch {}

// The visitor's spoken language, kept for their next visit (browser Whisper needs it).
try {
  const saved = localStorage.getItem("beaver-language");
  if (saved && [...$("language").options].some((o) => o.value === saved)) $("language").value = saved;
} catch {}
$("language").addEventListener("change", () => {
  try {
    localStorage.setItem("beaver-language", $("language").value);
  } catch {}
});

function showVoiceMode() {
  document.querySelectorAll("#voice-mode button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.value === voiceMode)));
  $("voice-hint").textContent = HINTS[voiceMode];
  $("talk").textContent = voiceMode === "device" ? "Hold to talk" : "Start call";
  // Workers AI Whisper detects the language itself.
  $("language-field").hidden = voiceMode !== "device";
}

document.querySelectorAll("#voice-mode button").forEach((button) => {
  button.addEventListener("click", () => {
    if (voice?.inCall) toggleCall();
    voiceMode = button.dataset.value;
    try {
      localStorage.setItem("beaver-voice", voiceMode);
    } catch {}
    showVoiceMode();
  });
});

const talk = $("talk");
talk.addEventListener("pointerdown", (event) => {
  if (voiceMode !== "device") return;
  event.preventDefault();
  talk.setPointerCapture(event.pointerId);
  startRecording();
});
talk.addEventListener("pointerup", () => voiceMode === "device" && stopRecording());
talk.addEventListener("pointercancel", () => voiceMode === "device" && stopRecording());
talk.addEventListener("click", () => voiceMode === "cloudflare" && toggleCall());
talk.addEventListener("keydown", (event) => {
  if (voiceMode === "device" && (event.key === " " || event.key === "Enter") && !event.repeat) {
    event.preventDefault();
    startRecording();
  }
});
talk.addEventListener("keyup", (event) => {
  if (voiceMode === "device" && (event.key === " " || event.key === "Enter")) stopRecording();
});

// ---- Start --------------------------------------------------------------------------------------

showVoiceMode();
if (!session || !key) {
  $("link-error").hidden = false;
  $("ask").hidden = true;
  $("connection").textContent = "No session";
} else {
  follow();
  showNotebooks();
}
