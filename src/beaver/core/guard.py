"""Guard for text that leaves the rover or the laptop, or gets spoken: personal information and length.

Rules are data: a name, a pattern, an optional validator, and the phrase spoken in place of what
it finds. check() lists findings (rule and position, never the matched text), redact() replaces
them, and shorten() cuts text at a sentence boundary. Everything runs locally with no network call.

The first version covers phone numbers, emails, addresses, postal codes, and ID and card numbers.
Names are out of scope: regex cannot tell a visitor's name from Louis Riel's.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass


def luhn(digits: str) -> bool:
    """The mod-10 check digit used by payment cards, social insurance, and Ontario health numbers."""
    total = 0
    for i, ch in enumerate(reversed(digits)):
        n = int(ch)
        if i % 2:
            n = n * 2 - 9 if n > 4 else n * 2
        total += n
    return total % 10 == 0


def _digits(text: str) -> str:
    return re.sub(r"\D", "", text)


def _sin(match: str) -> bool:
    # Social insurance numbers never start with 0 or 8.
    digits = _digits(match)
    return digits[0] not in "08" and luhn(digits)


def _card(match: str) -> bool:
    # A run of four-digit groups that all read as years (1000 to 2099) is a list of dates.
    groups = re.findall(r"\d+", match)
    if len(groups) > 1 and all(len(g) == 4 and 1000 <= int(g) <= 2099 for g in groups):
        return False
    return luhn(_digits(match))


@dataclass(frozen=True)
class Rule:
    name: str
    pattern: re.Pattern
    spoken: str
    valid: Callable[[str], bool] | None = None


# Earlier rules win where two findings overlap, so the stricter shapes come first.
STREET = r"(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Crescent|Cres|Lane|Ln|Way|Court|Ct|Place|Pl|Terrace|Parkway|Pkwy)"
RULES = [
    Rule("email", re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b"), "an email address"),
    Rule(
        "health_card_qc",
        # Quebec RAMQ: four letters, then eight digits.
        re.compile(r"\b[A-Z]{4}[\s-]?\d{4}[\s-]?\d{4}\b"),
        "a health card number",
    ),
    Rule(
        "health_card_on",
        # Ontario: ten digits grouped 4-3-3, a Luhn check digit, and an optional version code.
        re.compile(r"(?<!\d)\d{4}[\s-]\d{3}[\s-]\d{3}(?:[\s-]?[A-Z]{2})?(?![\d-])"),
        "a health card number",
        lambda m: luhn(_digits(m)),
    ),
    Rule(
        "payment_card",
        # Written as four-digit groups (4-4-4-1 to 4-4-4-7) or as one unbroken run of 13-19 digits.
        re.compile(r"(?<!\d)(?:\d{4}[\s-]){3}\d{1,7}(?![\d-])|(?<!\d)\d{13,19}(?!\d)"),
        "a card number",
        _card,
    ),
    Rule(
        "social_insurance",
        re.compile(r"(?<!\d)\d{3}[\s-]?\d{3}[\s-]?\d{3}(?!\d)"),
        "an ID number",
        _sin,
    ),
    Rule(
        "phone",
        # North American numbers with an optional +1, then international numbers with a + prefix.
        re.compile(
            r"(?<![\d+])(?:\+?1[\s.-]?)?\(?[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)"
            r"|\+\d{1,3}(?:[\s.-]?\d{2,4}){2,5}(?!\d)"
        ),
        "a phone number",
    ),
    Rule(
        "postal_code",
        re.compile(
            r"\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][\s-]?\d[ABCEGHJ-NPRSTV-Z]\d\b",
            re.IGNORECASE,
        ),
        "a postal code",
    ),
    Rule(
        "address",
        # "221 Rideau Street" and "1234 rue Sainte-Catherine".
        re.compile(
            rf"\b\d{{1,6}}\s+(?:[A-Z][\w'.-]*\s+){{1,4}}{STREET}\b\.?"
            r"|\b\d{1,6},?\s+(?:rue|chemin|boulevard|avenue|promenade)\s+[\w'-]+(?:[\s-][A-Z][\w'-]*){0,3}",
            re.IGNORECASE,
        ),
        "an address",
    ),
]


@dataclass(frozen=True)
class Finding:
    rule: str
    start: int
    end: int


def check(text: str) -> list[Finding]:
    """Every finding, earliest first; where two overlap, the rule listed first keeps its span."""
    found: list[Finding] = []
    for rule in RULES:
        for m in rule.pattern.finditer(text):
            if rule.valid and not rule.valid(m.group()):
                continue
            if any(m.start() < f.end and f.start < m.end() for f in found):
                continue
            found.append(Finding(rule.name, m.start(), m.end()))
    return sorted(found, key=lambda f: f.start)


_SPOKEN = {rule.name: rule.spoken for rule in RULES}


def redact(text: str) -> tuple[str, list[Finding]]:
    """Replace each finding with its spoken phrase; return the new text and the findings."""
    findings = check(text)
    parts, last = [], 0
    for f in findings:
        parts += [text[last : f.start], _SPOKEN[f.rule]]
        last = f.end
    parts.append(text[last:])
    return "".join(parts), findings


# A sentence ends at . ! ? followed by a space or the end, or at a full-width 。！？, which
# Chinese and Japanese text follows with no space.
_SENTENCE_END = re.compile(r"[.!?](?=\s|$)|[。！？]")


def shorten(text: str, limit: int) -> tuple[str, float]:
    """Cut text to at most `limit` characters at the last sentence end that fits; with no sentence
    end in reach, cut at the last word boundary and end with a full stop. Returns the text and the
    share of characters dropped, which tells the caller whether the cut lost too much."""
    text = text.strip()
    if len(text) <= limit:
        return text, 0.0
    ends = [m.end() for m in _SENTENCE_END.finditer(text) if m.end() <= limit]
    if ends:
        cut = text[: ends[-1]]
    else:
        cut = text[:limit].rsplit(" ", 1)[0].rstrip(",;:") + "."
    return cut, 1 - len(cut) / len(text)
