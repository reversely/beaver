// Record the question while the button is held, convert it to 16 kHz mono WAV, and send it to the
// rover. The session token comes from the QR code's address.

const RATE = 16000;
// Stays under phone.max_upload_bytes (1 MiB holds 32 s at 16 kHz, 16-bit).
const MAX_SECONDS = 30;
const MIN_SECONDS = 0.4;

const token = new URLSearchParams(location.search).get("t") || "";
const talk = document.getElementById("talk");
const statusLine = document.getElementById("status");
const answer = document.getElementById("answer");
const replyText = document.getElementById("reply");

let stream = null;
let recorder = null;
let busy = false;

function setStatus(text) {
  statusLine.textContent = text;
}

async function startRecording() {
  if (busy || recorder) return;
  // AudioContext must start inside the press for iOS Safari to allow it.
  const context = new AudioContext();
  try {
    // The stream stays open between questions, so the browser asks for permission once.
    stream ??= await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    await context.close();
    setStatus("Beaver needs the microphone. Allow microphone access for this page, then try again.");
    return;
  }
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  processor.onaudioprocess = (event) => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    if (chunks.length * 4096 > context.sampleRate * MAX_SECONDS) stopRecording();
  };
  source.connect(processor);
  processor.connect(context.destination);
  recorder = { context, processor, chunks };
  talk.classList.add("is-recording");
  talk.textContent = "Listening";
  setStatus("Beaver is listening. Release the button when you finish.");
}

async function stopRecording() {
  if (!recorder) return;
  const { context, processor, chunks } = recorder;
  recorder = null;
  processor.disconnect();
  const rate = context.sampleRate;
  await context.close();
  talk.classList.remove("is-recording");
  talk.textContent = "Hold to talk";
  const length = chunks.reduce((n, c) => n + c.length, 0);
  if (length < rate * MIN_SECONDS) {
    setStatus("That was too short. Hold the button the whole time you speak.");
    return;
  }
  const samples = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  send(encodeWav(await resample(samples, rate)));
}

async function resample(samples, rate) {
  if (rate === RATE) return samples;
  const offline = new OfflineAudioContext(1, Math.ceil((samples.length * RATE) / rate), RATE);
  const buffer = offline.createBuffer(1, samples.length, rate);
  buffer.copyToChannel(samples, 0);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  return (await offline.startRendering()).getChannelData(0);
}

function encodeWav(samples) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at, s) => [...s].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return new Blob([view.buffer], { type: "audio/wav" });
}

async function send(wav) {
  busy = true;
  talk.disabled = true;
  setStatus("Beaver is thinking about your question.");
  try {
    const response = await fetch(`/api/ask?t=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: wav,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setStatus(body.error || "Beaver could not answer. Please try again.");
      return;
    }
    replyText.textContent = body.reply;
    answer.hidden = false;
    setStatus("Beaver is answering through the rover's speaker.");
  } catch {
    setStatus("The phone lost its connection to the rover. Check the signal, then try again.");
  } finally {
    busy = false;
    talk.disabled = false;
  }
}

talk.addEventListener("pointerdown", (event) => {
  talk.setPointerCapture(event.pointerId);
  startRecording();
});
talk.addEventListener("pointerup", stopRecording);
talk.addEventListener("pointercancel", stopRecording);
talk.addEventListener("contextmenu", (event) => event.preventDefault());
talk.addEventListener("keydown", (event) => {
  if ((event.key === " " || event.key === "Enter") && !event.repeat) {
    event.preventDefault();
    startRecording();
  }
});
talk.addEventListener("keyup", (event) => {
  if (event.key === " " || event.key === "Enter") stopRecording();
});
