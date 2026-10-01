// Review notebooks in the agent's SQL storage (#62). The laptop sends the notebook prompt it
// renders from prompts/notebook.md, with ${notebooks} left for the agent to fill from its own
// tables, plus the schema and the lists a reply must stay within.

export interface FilingRequest {
  prompt: string;
  schema: Record<string, unknown>;
  pieces: string[];
  themes: string[];
  max_vocabulary: number;
  max_concepts: number;
  // The answer in the first official language, which the notebook entry keeps.
  answer: string;
  // Seconds before a filed word's first review (#63).
  review_first_seconds?: number;
}

export interface NotebookRow {
  id: string;
  title_en: string;
  title_fr: string;
  theme: string;
  artifact: string | null;
  year_start: number;
  year_end: number;
  entries?: number;
}

export interface Vocabulary {
  en: string;
  fr: string;
  visitor: string;
  meaning: string;
}

export interface Filing {
  notebook: Omit<NotebookRow, "entries" | "artifact"> & { artifact: string | null };
  vocabulary: Vocabulary[];
  concepts: { title: string; summary: string; why_it_matters: string }[];
  moments: { year: number; event: string }[];
}

export const NONE_YET = "(none yet)";

/** The lines that replace ${notebooks} in the prompt, as notebooks.file_exchange writes them. */
export function listing(rows: NotebookRow[]): string {
  if (rows.length === 0) return NONE_YET;
  return rows
    .map((n) => `- id ${n.id}: ${n.title_en} (${n.theme}, ${n.year_start}-${n.year_end})`)
    .join("\n");
}

function str(value: unknown, limit = 400): string {
  if (typeof value !== "string") throw new TypeError("Filing field is not text");
  return value.slice(0, limit);
}

function year(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < -10000 || (value as number) > 3000) {
    throw new TypeError("Filing year is not a whole year");
  }
  return value as number;
}

/** The model's reply checked against the schema's rules, trimmed to the limits. A piece or a
 * theme outside its list is refused, as the laptop's notebooks.py refuses an unlisted piece. */
export function checkFiling(reply: unknown, request: FilingRequest): Filing {
  const raw = reply as Record<string, unknown> | null;
  const notebook = raw?.notebook as Record<string, unknown> | undefined;
  if (!raw || !notebook) throw new TypeError("Filing has no notebook");
  const theme = str(notebook.theme);
  if (!request.themes.includes(theme)) throw new TypeError("Filing theme is not listed");
  const artifact = typeof notebook.artifact === "string" && request.pieces.includes(notebook.artifact)
    ? notebook.artifact
    : null;
  const list = (value: unknown) => (Array.isArray(value) ? value : []);
  return {
    notebook: {
      id: str(notebook.id, 16),
      title_en: str(notebook.title_en, 120),
      title_fr: str(notebook.title_fr, 120),
      theme,
      artifact,
      year_start: year(notebook.year_start),
      year_end: year(notebook.year_end),
    },
    vocabulary: list(raw.vocabulary)
      .slice(0, request.max_vocabulary)
      .map((v) => ({ en: str(v?.en), fr: str(v?.fr), visitor: str(v?.visitor), meaning: str(v?.meaning) })),
    concepts: list(raw.concepts)
      .slice(0, request.max_concepts)
      .map((c) => ({
        title: str(c?.title),
        summary: str(c?.summary),
        why_it_matters: str(c?.why_it_matters),
      })),
    moments: list(raw.moments).map((m) => ({ year: year(m?.year), event: str(m?.event) })),
  };
}

/** A new notebook's id: eight hex characters, as notebooks.py makes them. */
export function newId(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 8);
}
