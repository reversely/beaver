// Page logic: settings, hold-to-talk recording, camera frames, and in-order sentence playback.
import { openNotebook, refreshNotebooks, showConversation } from "./notebooks.js";

const $ = (selector) => document.querySelector(selector);
const talk = $("#talk");
const askButton = $(".ask");
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
    group.querySelectorAll("button").forEach((button) => {
      button.setAttribute("aria-checked", String(button.dataset.value === settings[section][key]));
    });
  });
  document.querySelectorAll("input[data-setting]").forEach((input) => {
    const [section, key] = settingPath(input);
    input.checked = Boolean(settings[section][key]);
  });
}

async function saveSetting(section, key, value) {
  const response = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [section]: { [key]: value } }),
  });
  const body = await response.json();
  if (!response.ok) {
    setStatus(body.error, true);
    return;
  }
  showSettings(body);
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

fetch("/api/settings").then((r) => r.json()).then(showSettings);

// Settings start collapsed on narrow screens, where the sidebar stacks above the conversation.
if (window.matchMedia("(max-width: 899px)").matches) $("#settings").open = false;

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
  ask({ audio_wav: encodeWav(chunks, context.sampleRate) });
}

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

talk.addEventListener("pointerdown", (event) => {
  talk.setPointerCapture(event.pointerId);
  startRecording();
});
talk.addEventListener("pointerup", stopRecording);
talk.addEventListener("pointercancel", stopRecording);
talk.addEventListener("keydown", (event) => {
  if ((event.key === " " || event.key === "Enter") && !event.repeat) {
    event.preventDefault();
    startRecording();
  }
});
talk.addEventListener("keyup", (event) => {
  if (event.key === " " || event.key === "Enter") stopRecording();
});

$("#typed").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = typedInput.value.trim();
  if (!text || busy) return;
  typedInput.value = "";
  ask({ text });
});

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
  showConversation();
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
    const response = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
      for (const line of lines) {
        if (line.trim()) handleEvent(JSON.parse(line), turn, groups, player);
      }
    }
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
    } else {
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
    const link = document.createElement("button");
    link.type = "button";
    link.className = "tag tag-link";
    link.textContent = event.title_en;
    link.title = "Open notebook";
    link.addEventListener("click", () => openNotebook(event.id));
    turn.querySelector(".turn-meta").append(link);
  } else if (event.type === "notebook_error") {
    addTag(turn, "not filed");
  } else if (event.type === "error") {
    setStatus(event.message, true);
  }
}
