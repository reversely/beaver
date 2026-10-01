// Sentence splitting and language order for the agent (#64), ported from core/sentences.py and
// desktop/bilingual.py so a turn the page asks for comes back in the same groups.

// Abbreviations that end in a period but do not end a sentence.
const ABBREVIATIONS = new Set([
  "st", "ste", "mt", "ft", "mr", "mrs", "ms", "dr", "jr", "sr", "no", "vs",
  "blvd", "ave", "rd", "e.g", "i.e",
]);

/** Split after . ! ? and their CJK forms, keeping abbreviations such as "St." whole. */
export function splitSentences(text: string): string[] {
  const pieces = text.trim().split(/(?<=[.!?])\s+|(?<=[。！？])\s*/);
  const sentences: string[] = [];
  for (const piece of pieces) {
    const previous = sentences.length
      ? (sentences.at(-1)!.split(" ").at(-1) ?? "").replace(/\.+$/, "").toLowerCase()
      : "";
    if (ABBREVIATIONS.has(previous)) sentences[sentences.length - 1] += ` ${piece}`;
    else if (piece) sentences.push(piece);
  }
  return sentences;
}

export interface LanguageSettings {
  official: "en" | "fr" | "both";
  include_visitor_language: boolean;
  order: "official_first" | "visitor_first";
}

export const DEFAULT_LANGUAGES: LanguageSettings = {
  official: "en",
  include_visitor_language: true,
  order: "official_first",
};

const OFFICIAL = { en: ["en"], fr: ["fr"], both: ["en", "fr"] } as const;
export const NAMES: Record<string, string> = { en: "English", fr: "French" };

export function officialCodes(settings: LanguageSettings): string[] {
  return [...OFFICIAL[settings.official]];
}

/** The languages each sentence is spoken in, in speaking order, without repeats. */
export function orderedCodes(settings: LanguageSettings, visitor: string): string[] {
  const official = officialCodes(settings);
  if (!settings.include_visitor_language || official.includes(visitor)) return official;
  return settings.order === "visitor_first" ? [visitor, ...official] : [...official, visitor];
}

export type Group = [string, string][];

/** Pair sentences by position. A language whose list has the wrong length is dropped. */
export function group(
  codes: string[],
  translations: Record<string, string[]>,
  count: number,
): { codes: string[]; groups: Group[]; dropped: string[] } {
  const dropped = codes.filter((c) => (translations[c]?.length ?? -1) !== count);
  const kept = codes.filter((c) => !dropped.includes(c));
  const groups = Array.from({ length: count }, (_, i) =>
    kept.map((c) => [c, translations[c][i]] as [string, string]),
  );
  return { codes: kept, groups, dropped };
}

/** A visitor language tag from the model reduced to its base code, as bilingual._visitor does. */
export function visitorOf(name: string, tag: string) {
  return { name, tag, code: tag.toLowerCase().replace("_", "-").split("-")[0] };
}
