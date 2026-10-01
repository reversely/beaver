// The guard proxy for the Cloudflare page and the agent (#64, #65): the rules of
// src/beaver/core/guard.py, ported so a question is redacted before it leaves the browser, and so
// the agent can redact a transcript it made itself. src/beaver/core/guard_cases.json holds cases
// both versions must pass; agent/test/guard.test.ts and the rover's test_guard.py check them.
//
// Python's \w and \b match any letter; JavaScript's match ASCII only. W and the two boundary
// lookarounds below stand in for them, so "élodie" counts as one word as it does in Python.

const W = "[\\p{L}\\p{N}_]";
const START = `(?<!${W})`;
const END = `(?!${W})`;

function digits(text) {
  return text.replace(/\D/g, "");
}

/** The mod-10 check digit used by payment cards, social insurance, and Ontario health numbers. */
export function luhn(number) {
  let total = 0;
  [...number].reverse().forEach((ch, i) => {
    let n = Number(ch);
    if (i % 2) n = n > 4 ? n * 2 - 9 : n * 2;
    total += n;
  });
  return total % 10 === 0;
}

function sin(match) {
  // Social insurance numbers never start with 0 or 8.
  const d = digits(match);
  return !"08".includes(d[0]) && luhn(d);
}

function card(match) {
  // A run of four-digit groups that all read as years (1000 to 2099) is a list of dates.
  const groups = match.match(/\d+/g);
  if (groups.length > 1 && groups.every((g) => g.length === 4 && +g >= 1000 && +g <= 2099)) {
    return false;
  }
  return luhn(digits(match));
}

const STREET =
  "(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Crescent|Cres|Lane|Ln|Way|Court|Ct|Place|Pl|Terrace|Parkway|Pkwy)";

// Earlier rules win where two findings overlap, so the stricter shapes come first.
export const RULES = [
  {
    name: "email",
    pattern: new RegExp(`${START}[\\p{L}\\p{N}_.+-]+@[\\p{L}\\p{N}_-]+(?:\\.[\\p{L}\\p{N}_-]+)+${END}`, "gu"),
    spoken: "an email address",
  },
  {
    name: "health_card_qc",
    // Quebec RAMQ: four letters, then eight digits.
    pattern: new RegExp(`${START}[A-Z]{4}[\\s-]?\\d{4}[\\s-]?\\d{4}${END}`, "gu"),
    spoken: "a health card number",
  },
  {
    name: "health_card_on",
    // Ontario: ten digits grouped 4-3-3, a Luhn check digit, and an optional version code.
    pattern: /(?<!\d)\d{4}[\s-]\d{3}[\s-]\d{3}(?:[\s-]?[A-Z]{2})?(?![\d-])/gu,
    spoken: "a health card number",
    valid: (m) => luhn(digits(m)),
  },
  {
    name: "payment_card",
    // Written as four-digit groups (4-4-4-1 to 4-4-4-7) or as one unbroken run of 13-19 digits.
    pattern: /(?<!\d)(?:\d{4}[\s-]){3}\d{1,7}(?![\d-])|(?<!\d)\d{13,19}(?!\d)/gu,
    spoken: "a card number",
    valid: card,
  },
  {
    name: "social_insurance",
    pattern: /(?<!\d)\d{3}[\s-]?\d{3}[\s-]?\d{3}(?!\d)/gu,
    spoken: "an ID number",
    valid: sin,
  },
  {
    name: "phone",
    // North American numbers with an optional +1, then international numbers with a + prefix.
    pattern:
      /(?<![\d+])(?:\+?1[\s.-]?)?\(?[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)|\+\d{1,3}(?:[\s.-]?\d{2,4}){2,5}(?!\d)/gu,
    spoken: "a phone number",
  },
  {
    name: "postal_code",
    pattern: new RegExp(
      `${START}[ABCEGHJ-NPRSTVXY]\\d[ABCEGHJ-NPRSTV-Z][\\s-]?\\d[ABCEGHJ-NPRSTV-Z]\\d${END}`,
      "giu",
    ),
    spoken: "a postal code",
  },
  {
    name: "address",
    // "221 Rideau Street" and "1234 rue Sainte-Catherine".
    pattern: new RegExp(
      `${START}\\d{1,6}\\s+(?:[A-Z][\\p{L}\\p{N}_'.-]*\\s+){1,4}${STREET}${END}\\.?` +
        `|${START}\\d{1,6},?\\s+(?:rue|chemin|boulevard|avenue|promenade)\\s+[\\p{L}\\p{N}_'-]+(?:[\\s-][A-Z][\\p{L}\\p{N}_'-]*){0,3}`,
      "giu",
    ),
    spoken: "an address",
  },
];

/** Every finding as {rule, start, end}, earliest first; where two overlap, the rule listed first
 * keeps its span. */
export function check(text) {
  const found = [];
  for (const rule of RULES) {
    for (const m of text.matchAll(rule.pattern)) {
      const start = m.index;
      const end = start + m[0].length;
      if (rule.valid && !rule.valid(m[0])) continue;
      if (found.some((f) => start < f.end && f.start < end)) continue;
      found.push({ rule: rule.name, start, end });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

const SPOKEN = Object.fromEntries(RULES.map((r) => [r.name, r.spoken]));

/** The text with each finding replaced by its spoken phrase, and the rules that fired. */
export function redact(text) {
  const findings = check(text);
  let out = "";
  let last = 0;
  for (const f of findings) {
    out += text.slice(last, f.start) + SPOKEN[f.rule];
    last = f.end;
  }
  return { text: out + text.slice(last), rules: findings.map((f) => f.rule) };
}
