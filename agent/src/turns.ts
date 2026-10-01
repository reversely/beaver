// The live session's turns (#61): what the laptop publishes after its guard has checked a turn,
// checked here before it enters the agent's state and reaches every viewer.

export interface Sentence {
  group: number;
  code: string;
  text: string;
}

export interface Turn {
  at: string;
  // Steps of a voice-call turn, added by the agent itself (#67).
  trace?: unknown[];
  question: string;
  visitor: { name: string; code: string };
  sentences: Sentence[];
}

// The viewer shows the latest turns; older ones stay in the laptop's run records.
export const MAX_TURNS = 20;
const MAX_TEXT = 2000;
const MAX_SENTENCES = 40;

function text(value: unknown, limit = MAX_TEXT): string {
  if (typeof value !== "string" || value.length > limit) throw new TypeError("Bad turn text");
  return value;
}

/** A turn with exactly the expected fields, or a TypeError. Extra fields are dropped. */
export function checkTurn(value: unknown, now = new Date()): Turn {
  const raw = value as Record<string, unknown> | null;
  const visitor = raw?.visitor as Record<string, unknown> | undefined;
  const sentences = raw?.sentences;
  if (!raw || !visitor || !Array.isArray(sentences) || sentences.length > MAX_SENTENCES) {
    throw new TypeError("Bad turn");
  }
  return {
    at: now.toISOString(),
    question: text(raw.question),
    visitor: { name: text(visitor.name, 64), code: text(visitor.code, 16) },
    sentences: sentences.map((s: Record<string, unknown>) => {
      if (!Number.isInteger(s?.group)) throw new TypeError("Bad sentence group");
      return { group: s.group as number, code: text(s.code, 16), text: text(s.text) };
    }),
  };
}

export function addTurn(turns: Turn[], turn: Turn): Turn[] {
  return [...turns, turn].slice(-MAX_TURNS);
}
