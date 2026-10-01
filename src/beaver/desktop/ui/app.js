// Page logic: settings, hold-to-talk recording, camera frames, and in-order sentence playback.
// Every server call goes through backend.js, so this page runs on the laptop and on the
// Cloudflare agent alike (#65).
import * as backend from "./backend.js";
import { notebookHash, refreshNotebooks } from "./notebooks.js";
import { go, start } from "./router.js";

const $ = (selector) => document.querySelector(selector);
const talk = $("#talk");
const askButton = $("#typed .ask");
const typedInput = $("#typed-input");
const statusLine = $("#status");
const thread = $("#thread");

const LANGUAGE_NAMES = new Intl.DisplayNames(["en"], { type: "language" });
let busy = false;

// ---- Settings -------------------------------------------------------------------------------

function settingPath(element) {
  return element.dataset.setting.split(".");
}

function showSettings(settings) {
  document.querySelectorAll(".seg[data-setting]").forEach((group) => {
    const [section, key] = settingPath(group);
    // A setting the backend lacks, such as the provider on the Cloudflare page, is left alone.
    if (settings[section]?.[key] === undefined) return;
    group.querySelectorAll("button").forEach((button) => {
      button.setAttribute("aria-checked", String(button.dataset.value === settings[section][key]));
    });
  });
  document.querySelectorAll("input[data-setting]").forEach((input) => {
    const [section, key] = settingPath(input);
    if (settings[section]?.[key] === undefined) return;
    input.checked = Boolean(settings[section][key]);
  });
  // live-session.js shows the session link when the provider is Cloudflare.
  document.dispatchEvent(new CustomEvent("settings", { detail: settings }));
}

async function saveSetting(section, key, value) {
  try {
    showSettings(await backend.saveSetting(section, key, value));
  } catch (error) {
    setStatus(error.message, true);
  }
}

document.querySelectorAll(".seg[data-setting] button").forEach((button) => {
  button.addEventListener("click", () => {
    const [section, key] = settingPath(button.closest(".seg"));
    saveSetting(section, key, button.dataset.value);
  });
});
document.querySelectorAll("input[data-setting]").forEach((input) => {
  input.addEventListener("change", () => {
    const [section, key] = settingPath(input);
    saveSetting(section, key, input.checked);
  });
});

backend.getSettings().then(showSettings).catch((error) => setStatus(error.message, true));

// The province and municipality mapped from the rover's phone location, refreshed after each sync.
async function showPlace() {
  const place = await backend.getPlace();
  $("#place-field").hidden = !place.municipality;
  if (place.municipality) $("#place-name").textContent = `${place.municipality}, ${place.province}`;
  const around = place.municipality || "you";
  document.querySelectorAll("[data-place-prompt]").forEach((line) => {
    line.textContent = `Ask about anything you see around ${around}`;
  });
}
showPlace();
if (backend.BACKEND === "laptop") setInterval(showPlace, 60000);


// ---- Status ---------------------------------------------------------------------------------

function setStatus(text, isError = false) {
  statusLine.textContent = text;
  statusLine.classList.toggle("is-error", isError);
}

function setBusy(value) {
  busy = value;
  talk.disabled = value;
  askButton.disabled = value;
}

// ---- Camera ---------------------------------------------------------------------------------

const cameraToggle = $("#camera-toggle");
const cameraView = $("#camera-view");
let cameraStream = null;

cameraToggle.addEventListener("change", async () => {
  if (cameraToggle.checked) {
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
      cameraView.srcObject = cameraStream;
      cameraView.hidden = false;
      await cameraView.play();
    } catch {
      cameraToggle.checked = false;
      setStatus("Please allow camera access in the browser", true);
    }
  } else {
    cameraStream?.getTracks().forEach((track) => track.stop());
    cameraStream = null;
    cameraView.hidden = true;
  }
});

function captureFrame() {
  if (!cameraStream || !cameraView.videoWidth) return null;
  const width = Math.min(1024, cameraView.videoWidth);
  const height = Math.round((cameraView.videoHeight / cameraView.videoWidth) * width);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(cameraView, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
}

// ---- Microphone: 16-bit mono WAV, which Gemini accepts and MediaRecorder's WebM is not -------

let recorder = null;

async function startRecording() {
  if (busy || recorder) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    setStatus("Please allow microphone access in the browser", true);
    return;
  }
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  processor.onaudioprocess = (event) => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  source.connect(processor);
  processor.connect(context.destination);
  recorder = { stream, context, processor, chunks };
  talk.classList.add("is-recording");
  talk.querySelector(".talk-label").textContent = "Listening";
  setStatus("listening");
}

async function stopRecording() {
  if (!recorder) return;
  const { stream, context, processor, chunks } = recorder;
  recorder = null;
  processor.disconnect();
  stream.getTracks().forEach((track) => track.stop());
  await context.close();
  talk.classList.remove("is-recording");
  talk.querySelector(".talk-label").textContent = "Hold to talk";
  const samples = chunks.reduce((n, c) => n + c.length, 0);
  if (samples < context.sampleRate * 0.4) {
    setStatus("Please hold the button while you speak");
    return;
  }
  ask({ audio: { chunks, rate: context.sampleRate } });
}

// On the Cloudflare page the visitor picks how speech is heard: "device" runs Whisper in the
// browser while they hold the button; "call" streams to the agent's voice pipeline (#64).
const holding = () => backend.BACKEND === "laptop" || voiceMode === "device";

talk.addEventListener("pointerdown", (event) => {
  if (!holding()) return;
  talk.setPointerCapture(event.pointerId);
  startRecording();
});
talk.addEventListener("pointerup", () => holding() && stopRecording());
talk.addEventListener("pointercancel", () => holding() && stopRecording());
talk.addEventListener("click", () => !holding() && toggleCall());
talk.addEventListener("keydown", (event) => {
  if (holding() && (event.key === " " || event.key === "Enter") && !event.repeat) {
    event.preventDefault();
    startRecording();
  }
});
talk.addEventListener("keyup", (event) => {
  if (holding() && (event.key === " " || event.key === "Enter")) stopRecording();
});

// ---- Cloudflare page: spoken language and voice mode ------------------------------------------

const languagePick = $("#spoken-language");
let voiceMode = "device";
let call = null;
let callTurns = null;

function remember(name, value) {
  try {
    localStorage.setItem(name, value);
  } catch {}
}

function recall(name) {
  try {
    return localStorage.getItem(name);
  } catch {
    return null;
  }
}

if (backend.BACKEND === "agent") {
  const saved = recall("beaver-language");
  if (saved && [...languagePick.options].some((o) => o.value === saved)) languagePick.value = saved;
  languagePick.addEventListener("change", () => remember("beaver-language", languagePick.value));
  voiceMode = recall("beaver-voice") === "call" ? "call" : "device";
  showVoiceMode();
  document.querySelectorAll("#voice-mode button").forEach((button) => {
    button.addEventListener("click", async () => {
      if (call?.inCall) await toggleCall();
      voiceMode = button.dataset.value;
      remember("beaver-voice", voiceMode);
      showVoiceMode();
    });
  });
}

function showVoiceMode() {
  document.querySelectorAll("#voice-mode button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.value === voiceMode)));
  $("#language-field").hidden = voiceMode !== "device";
  $("#voice-note").textContent =
    voiceMode === "device"
      ? "Speech is transcribed on this device; the first use downloads a 77 MB model."
      : "Speech streams to Cloudflare, which transcribes it and removes personal information there.";
  talk.querySelector(".talk-label").textContent = voiceMode === "device" ? "Hold to talk" : "Start call";
}

async function toggleCall() {
  call ??= backend.voiceCall(setStatus);
  try {
    const active = await call.toggle();
    talk.classList.toggle("is-recording", active);
    talk.querySelector(".talk-label").textContent = active ? "End call" : "Start call";
    callTurns = active ? null : callTurns;
  } catch (error) {
    setStatus(`The call could not start: ${error.message}`, true);
  }
}

// During a call the agent publishes each turn to the session's state; live-session.js passes the
// state on, and new turns are drawn here like any other. The call's own audio plays from the
// voice client, so these lines carry none.
const drawnCallTurns = new Map();
document.addEventListener("session-state", (event) => {
  const turns = event.detail.turns ?? [];
  if (!call?.inCall) {
    callTurns = turns.length;
    return;
  }
  for (const done of turns.slice(callTurns ?? turns.length)) {
    const turn = newTurn(done.question);
    const groups = turn.querySelector(".groups");
    const player = new Player(() => {});
    handleEvent({ type: "question", question: done.question, visitor: done.visitor }, turn, groups, player);
    for (const s of done.sentences) handleEvent({ type: "sentence", ...s, audio: null, spokenElsewhere: true }, turn, groups, player);
    drawnCallTurns.set(done.at, turn);
  }
  callTurns = turns.length;
  // The agent adds a call turn's trace in a second state change, once its filing is queued (#67).
  for (const done of turns) {
    const turn = drawnCallTurns.get(done.at);
    if (turn && done.trace && !turn.querySelector(".trace")) renderTrace(turn, done.trace);
  }
});


$("#typed").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = typedInput.value.trim();
  if (!text || busy) return;
  typedInput.value = "";
  ask({ text });
});

// The overview's Ask Beaver tile sends its question from the Ask view, where the reply plays.
$("#overview-ask").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("#overview-input");
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = "";
  typedInput.value = text;
  go("#/ask");
  $("#typed").requestSubmit();
});

// ---- Demo mode: how each answer ran (#67) -------------------------------------------------------

// Off by default; the Settings switch or ?demo=1 turns it on, and this browser remembers it. The
// panels are built for every turn and only shown in the mode, so switching it on shows past turns.
const demoToggle = $("#demo-toggle");
const demoParam = new URLSearchParams(location.search).get("demo");
let demo = demoParam === "1" || (demoParam !== "0" && recall("beaver-demo") === "1");

function showDemo() {
  document.body.classList.toggle("is-demo", demo);
  demoToggle.checked = demo;
}
demoToggle.addEventListener("change", () => {
  demo = demoToggle.checked;
  remember("beaver-demo", demo ? "1" : "0");
  showDemo();
});
showDemo();

const WHERE = {
  browser: "This browser",
  laptop: "Laptop",
  worker: "Cloudflare Worker",
  agent: "Durable Object",
  "workers-ai": "Workers AI",
};

function duration(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** The "How it ran" panel for one turn: each step, where it ran, its time, and its facts. Every
 * value is set as text. */
function renderTrace(turn, spans) {
  turn.querySelector(".trace")?.remove();
  const panel = document.createElement("details");
  panel.className = "trace";
  panel.open = true;
  const summary = document.createElement("summary");
  const timed = spans.filter((s) => typeof s.ms === "number");
  summary.textContent = `How it ran: ${spans.length} steps`;
  panel.append(summary);
  const longest = Math.max(1, ...timed.map((s) => s.ms));
  const list = document.createElement("ol");
  list.className = "trace-steps";
  for (const s of spans) {
    const item = document.createElement("li");
    item.className = "trace-step";
    const head = document.createElement("div");
    head.className = "trace-head";
    const where = document.createElement("span");
    where.className = `where where-${s.where}`;
    where.textContent = WHERE[s.where] ?? s.where;
    const name = document.createElement("span");
    name.className = "trace-name";
    name.textContent = s.step;
    const time = document.createElement("span");
    time.className = "trace-ms";
    time.textContent = duration(s.ms);
    head.append(where, name, time);
    item.append(head);
    if (typeof s.ms === "number") {
      const bar = document.createElement("div");
      bar.className = `trace-bar where-${s.where}`;
      bar.style.setProperty("--share", String(Math.max(0.01, s.ms / longest)));
      bar.setAttribute("aria-hidden", "true");
      item.append(bar);
    }
    if (s.facts?.length) {
      const facts = document.createElement("dl");
      facts.className = "trace-facts";
      for (const [label, value] of s.facts) {
        const dt = document.createElement("dt");
        dt.textContent = label;
        const dd = document.createElement("dd");
        dd.textContent = value;
        facts.append(dt, dd);
      }
      item.append(facts);
    }
    if (s.text) {
      const sent = document.createElement("p");
      sent.className = "trace-text";
      sent.dir = "auto";
      sent.textContent = s.text;
      item.append(sent);
    }
    list.append(item);
  }
  panel.append(list);
  turn.append(panel);
}

// ---- Turns ----------------------------------------------------------------------------------

function languageName(code) {
  try {
    return LANGUAGE_NAMES.of(code);
  } catch {
    return code;
  }
}

function newTurn(placeholder) {
  $("#thread-empty")?.remove();
  const turn = document.createElement("article");
  turn.className = "turn";
  turn.innerHTML = '<p class="turn-question" dir="auto"></p><div class="turn-meta"></div><div class="groups"></div>';
  turn.querySelector(".turn-question").textContent = placeholder;
  thread.prepend(turn);
  return turn;
}

function addTag(turn, text) {
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = text;
  turn.querySelector(".turn-meta").append(tag);
  return tag;
}

// Plays sentences strictly in arrival order; the server sends them in speaking order.
class Player {
  constructor(onFirstAudio) {
    this.queue = [];
    this.playing = false;
    this.onFirstAudio = onFirstAudio;
    this.started = false;
  }

  add(item) {
    this.queue.push(item);
    if (!this.playing) this.next();
  }

  next() {
    const item = this.queue.shift();
    document.querySelectorAll(".is-speaking").forEach((el) => el.classList.remove("is-speaking"));
    if (!item) {
      this.playing = false;
      return;
    }
    this.playing = true;
    item.line.classList.add("is-speaking");
    item.line.closest(".group").classList.add("is-speaking");
    const audio = new Audio(item.url);
    audio.addEventListener("playing", () => {
      if (!this.started) {
        this.started = true;
        this.onFirstAudio();
      }
    }, { once: true });
    audio.addEventListener("ended", () => this.next());
    audio.addEventListener("error", () => this.next());
    audio.play().catch(() => this.next());
  }
}

async function ask(payload) {
  go("#/ask");
  setBusy(true);
  const sentAt = performance.now();
  const frame = captureFrame();
  if (frame) payload.image_jpeg = frame;
  const turn = newTurn(payload.text || "…");
  const groups = turn.querySelector(".groups");
  setStatus("thinking");
  const player = new Player(() => {
    addTag(turn, `first audio ${((performance.now() - sentAt) / 1000).toFixed(1)} s`);
    setStatus("speaking");
  });

  try {
    const options = { language: languagePick?.value, status: setStatus };
    for await (const event of backend.ask(payload, options)) handleEvent(event, turn, groups, player);
  } catch (error) {
    setStatus(`Beaver could not answer: ${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

function handleEvent(event, turn, groups, player) {
  if (event.type === "question") {
    turn.querySelector(".turn-question").textContent = event.question;
    turn.querySelector(".turn-question").lang = event.visitor.code;
    addTag(turn, event.visitor.name);
    turn.dataset.visitor = event.visitor.code;
  } else if (event.type === "sentence") {
    let group = groups.children[event.group];
    while (!group) {
      groups.append(Object.assign(document.createElement("div"), { className: "group" }));
      group = groups.children[event.group];
    }
    const line = document.createElement("p");
    line.className = "line";
    line.lang = event.code;
    line.dir = "auto";
    line.classList.toggle("is-visitor", event.code === turn.dataset.visitor);
    line.textContent = event.text;
    line.title = languageName(event.code);
    group.append(line);
    if (event.audio) {
      player.add({ url: event.audio, line });
    } else if (!event.spokenElsewhere) {
      // The voice model does not speak this language; the line shows without audio.
      line.classList.add("is-silent");
      line.title = `${languageName(event.code)}, shown only`;
    }
  } else if (event.type === "done") {
    if (!player.started) setStatus("");
    const wait = () => (player.playing ? setTimeout(wait, 300) : setStatus(""));
    wait();
  } else if (event.type === "notebook") {
    refreshNotebooks();
    const link = document.createElement("a");
    link.className = "tag tag-link";
    link.textContent = event.title_en;
    link.title = "Open notebook";
    link.href = notebookHash(event.id);
    turn.querySelector(".turn-meta").append(link);
  } else if (event.type === "trace") {
    renderTrace(turn, event.spans);
  } else if (event.type === "notebook_pending") {
    // The agent files the turn after it is published, a few seconds later (#62).
    setTimeout(refreshNotebooks, 8000);
  } else if (event.type === "notebook_error") {
    addTag(turn, "not filed");
  } else if (event.type === "error") {
    setStatus(event.message, true);
  }
}

start();
