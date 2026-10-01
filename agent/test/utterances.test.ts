import assert from "node:assert/strict";
import { test } from "node:test";
import { RATE, UtteranceCutter, wav } from "../src/utterances.ts";

// 20 ms chunks, as the voice client sends them.
const chunk = (level: number) => new Int16Array(RATE / 50).fill(Math.round(level * 32767));
const feed = (cutter: UtteranceCutter, level: number, count: number) => {
  const clips = [];
  for (let i = 0; i < count; i++) {
    const clip = cutter.push(chunk(level));
    if (clip) clips.push(clip);
  }
  return clips;
};

test("speech followed by silence makes one utterance with its preroll", () => {
  const cutter = new UtteranceCutter();
  assert.equal(feed(cutter, 0, 50).length, 0);
  assert.equal(feed(cutter, 0.2, 50).length, 0); // 1 s of speech
  const clips = feed(cutter, 0, 40); // 800 ms of silence ends it
  assert.equal(clips.length, 1);
  // 300 ms preroll + 1 s speech + 800 ms silence
  assert.equal(clips[0].length, (RATE * 2100) / 1000);
});

test("a click shorter than the minimum is dropped", () => {
  const cutter = new UtteranceCutter();
  feed(cutter, 0.2, 5); // 100 ms
  assert.equal(feed(cutter, 0, 40).length, 0);
});

test("a long utterance is cut at the maximum", () => {
  const cutter = new UtteranceCutter({ maxMs: 2000 });
  assert.equal(feed(cutter, 0.2, 100).length, 1);
});

test("the WAV header describes 16 kHz mono 16-bit audio", () => {
  const file = wav(new Int16Array(10));
  const view = new DataView(file.buffer);
  assert.equal(new TextDecoder().decode(file.slice(0, 4)), "RIFF");
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint32(40, true), 20);
  assert.equal(file.length, 64);
});
