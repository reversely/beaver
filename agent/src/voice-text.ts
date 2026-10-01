// Language tags for the voice pipeline (#64). onTurn returns one text stream, which the SDK's
// SentenceChunker cuts into pieces for speech and may merge short sentences; each sentence
// carries a tag naming its language, so speech can split a piece back into languages.
// Free of Worker globals for `node --test`.

const TAG = /⟦([a-z]{2,3})⟧\s*/g;

/** The groups as one text, each sentence tagged with its language, in speaking order. */
export function tagged(groups: [string, string][][]): string {
  return groups
    .flatMap((g) => g.map(([code, text]) => `⟦${code}⟧ ${text.trim()}`))
    .join(" ");
}

/** A piece of tagged text split by language. Text before the first tag takes `fallback`. */
export function splitTagged(text: string, fallback = "en"): { code: string; text: string }[] {
  const parts: { code: string; text: string }[] = [];
  let code = fallback;
  let last = 0;
  for (const m of text.matchAll(TAG)) {
    if (m.index > last) parts.push({ code, text: text.slice(last, m.index).trim() });
    code = m[1];
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ code, text: text.slice(last).trim() });
  return parts.filter((p) => p.text);
}

/** WAV clips in one format joined into one clip: the first header, every clip's samples. */
export function joinWavs(clips: Uint8Array[]): Uint8Array {
  if (clips.length === 1) return clips[0];
  const data = clips.map((clip) => {
    const view = new DataView(clip.buffer, clip.byteOffset, clip.byteLength);
    // Walk the chunks to "data"; MeloTTS may add a LIST chunk before it.
    let at = 12;
    while (at + 8 <= clip.length) {
      const id = String.fromCharCode(...clip.slice(at, at + 4));
      const size = view.getUint32(at + 4, true);
      if (id === "data") return { header: clip.slice(0, at), samples: clip.slice(at + 8, at + 8 + size) };
      at += 8 + size + (size % 2);
    }
    throw new Error("A speech clip has no data chunk");
  });
  const length = data.reduce((n, d) => n + d.samples.length, 0);
  const header = data[0].header;
  const out = new Uint8Array(header.length + 8 + length);
  out.set(header);
  const view = new DataView(out.buffer);
  view.setUint32(4, out.length - 8, true);
  out.set(new TextEncoder().encode("data"), header.length);
  view.setUint32(header.length + 4, length, true);
  let at = header.length + 8;
  for (const d of data) {
    out.set(d.samples, at);
    at += d.samples.length;
  }
  return out;
}
