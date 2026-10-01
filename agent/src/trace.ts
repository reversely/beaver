// Steps of one turn for the demo mode's "How it ran" panel (#67). Each span names where it ran,
// how long it took, and plain facts about it; none carries unguarded text. Free of Worker globals.

export type Where = "browser" | "laptop" | "worker" | "agent" | "workers-ai";

export interface Span {
  step: string;
  where: Where;
  ms: number | null;
  // Label and value pairs, shown in order.
  facts: [string, string][];
  // Text that crossed a boundary, already guarded; shown verbatim.
  text?: string;
}

export function span(step: string, where: Where, ms: number | null, facts: [string, string][] = [], text?: string): Span {
  return text === undefined ? { step, where, ms, facts } : { step, where, ms, facts, text };
}
