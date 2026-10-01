// Spaced review of notebook vocabulary (#63). Each filed word gets a review row; the agent's
// scheduler calls back when the word falls due, and the word joins the due list in the state.

export interface DueWord {
  id: number;
  en: string;
  fr: string;
  visitor: string;
  meaning: string;
}

// A remembered word waits this many times longer before its next review.
export const GROWTH = 2.5;
// Ten minutes by default, so a demo shows a due word within one session; the desktop app's
// review.first_interval_seconds overrides it.
export const DEFAULT_FIRST_SECONDS = 600;
const MAX_INTERVAL_SECONDS = 180 * 24 * 3600;

/** The wait before the next review: longer after a remembered word, back to the first interval
 * after a forgotten one. */
export function nextInterval(current: number, remembered: boolean, first: number): number {
  return remembered ? Math.min(Math.round(current * GROWTH), MAX_INTERVAL_SECONDS) : first;
}

/** A first interval from the laptop, kept between one minute and thirty days. */
export function firstInterval(value: unknown): number {
  if (!Number.isInteger(value)) return DEFAULT_FIRST_SECONDS;
  return Math.min(Math.max(value as number, 60), 30 * 24 * 3600);
}

export function addDue(due: DueWord[], word: DueWord): DueWord[] {
  return due.some((w) => w.id === word.id) ? due : [...due, word];
}

export function removeDue(due: DueWord[], id: number): DueWord[] {
  return due.filter((w) => w.id !== id);
}
