// Utterance cutting for the voice pipeline (#64). Workers AI whisper-large-v3-turbo transcribes a
// whole clip, not a stream, so the agent cuts the call's audio into utterances at silence and
// sends each one as a WAV file. Free of Worker globals for `node --test`.

export const RATE = 16000;

export interface CutterOptions {
  // RMS of a chunk, on a 0 to 1 scale, above which it counts as speech.
  threshold: number;
  // Silence that ends an utterance.
  silenceMs: number;
  // Speech shorter than this is dropped as a click or a cough.
  minSpeechMs: number;
  // An utterance this long is cut even without silence, to bound one Whisper request.
  maxMs: number;
  // Audio kept from before speech starts, so the first syllable is not lost.
  prerollMs: number;
}

export const DEFAULT_CUTTER: CutterOptions = {
  threshold: 0.02,
  silenceMs: 800,
  minSpeechMs: 300,
  maxMs: 30000,
  prerollMs: 300,
};

const ms = (samples: number) => (samples / RATE) * 1000;

export function rms(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) sum += (s / 32768) ** 2;
  return Math.sqrt(sum / samples.length);
}

/** Feed PCM chunks; `push` returns a finished utterance's samples when one ends. */
export class UtteranceCutter {
  #options: CutterOptions;
  #preroll: Int16Array[] = [];
  #speech: Int16Array[] = [];
  #speechSamples = 0;
  #voicedSamples = 0;
  #silentSamples = 0;

  constructor(options: Partial<CutterOptions> = {}) {
    this.#options = { ...DEFAULT_CUTTER, ...options };
  }

  push(chunk: Int16Array): Int16Array | null {
    const loud = rms(chunk) >= this.#options.threshold;
    if (this.#speech.length === 0) {
      if (!loud) {
        this.#preroll.push(chunk);
        while (this.#preroll.length > 1 && ms(total(this.#preroll) - this.#preroll[0].length) >= this.#options.prerollMs) {
          this.#preroll.shift();
        }
        return null;
      }
      this.#speech = [...this.#preroll];
      this.#speechSamples = total(this.#preroll);
      this.#preroll = [];
    }
    this.#speech.push(chunk);
    this.#speechSamples += chunk.length;
    if (loud) {
      this.#voicedSamples += chunk.length;
      this.#silentSamples = 0;
    } else {
      this.#silentSamples += chunk.length;
    }
    const ended = ms(this.#silentSamples) >= this.#options.silenceMs;
    const full = ms(this.#speechSamples) >= this.#options.maxMs;
    if (!ended && !full) return null;
    const voiced = this.#voicedSamples;
    const clip = concat(this.#speech);
    this.#speech = [];
    this.#speechSamples = this.#voicedSamples = this.#silentSamples = 0;
    return ms(voiced) >= this.#options.minSpeechMs ? clip : null;
  }
}

function total(chunks: Int16Array[]): number {
  return chunks.reduce((n, c) => n + c.length, 0);
}

function concat(chunks: Int16Array[]): Int16Array {
  const out = new Int16Array(total(chunks));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** 16 kHz mono 16-bit PCM wrapped in a WAV header. */
export function wav(samples: Int16Array): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(out.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, s, true));
  return out;
}

export function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
