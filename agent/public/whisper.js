// Whisper base in the browser (#64): the question is transcribed on the visitor's device, so its
// audio never leaves it. transformers.js runs the model with ONNX Runtime; the model files come
// from this Worker's /models/ route (R2), and the library and its runtime from jsDelivr.
const LIBRARY = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0";
const MODEL = "onnx-community/whisper-base";

let loading = null;

/** Load the model once; `progress(fraction)` reports the download. */
export function load(progress = () => {}) {
  loading ??= (async () => {
    const { pipeline, env } = await import(LIBRARY);
    env.allowLocalModels = false;
    env.remoteHost = `${location.origin}/models/`;
    env.remotePathTemplate = "{model}/";
    const files = new Map();
    return pipeline("automatic-speech-recognition", MODEL, {
      dtype: { encoder_model: "q8", decoder_model_merged: "q8" },
      device: "wasm",
      progress_callback: (event) => {
        if (event.status !== "progress" || !event.total) return;
        files.set(event.file, [event.loaded, event.total]);
        const [loaded, total] = [...files.values()].reduce(([a, b], [c, d]) => [a + c, b + d], [0, 0]);
        progress(loaded / total);
      },
    });
  })();
  loading.catch(() => (loading = null));
  return loading;
}

/** Text from 16 kHz mono samples in `language` (an ISO 639-1 code). transformers.js 4.3 has no
 * language detection and falls back to English, so the page asks the visitor which language they
 * speak, as the rover's phone page does. */
export async function transcribe(samples, language, progress) {
  const recognizer = await load(progress);
  const output = await recognizer(samples, { chunk_length_s: 30, task: "transcribe", language });
  return (output.text ?? "").trim();
}

/** Float32 samples at `rate` resampled to 16 kHz by linear interpolation. */
export function to16k(samples, rate) {
  if (rate === 16000) return samples;
  const out = new Float32Array(Math.round((samples.length * 16000) / rate));
  const step = rate / 16000;
  for (let i = 0; i < out.length; i++) {
    const at = i * step;
    const left = Math.floor(at);
    const right = Math.min(left + 1, samples.length - 1);
    out[i] = samples[left] + (samples[right] - samples[left]) * (at - left);
  }
  return out;
}
