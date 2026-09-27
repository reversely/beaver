"""Sentence-by-sentence replies in the official languages and the visitor's language.

Pipeline mode: Gemini answers once in the first official language, a local splitter cuts the
answer into sentences, and one batched Gemini request translates every sentence into every other
target language. Inline mode asks the answer call for every language at once, for comparison.
Either way the result is a list of sentence groups, each group holding one sentence per language.
"""

import json
import re
import time
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor

import argos
from beaver.core import gemini, speech
from beaver.core.record import RunRecord
from beaver.core.settings import render_prompt

OFFICIAL = {"en": ["en"], "fr": ["fr"], "both": ["en", "fr"]}
NAMES = {"en": "English", "fr": "French"}

# Abbreviations that end in a period but do not end a sentence.
# fmt: off
ABBREVIATIONS = {
    "st", "ste", "mt", "ft", "mr", "mrs", "ms", "dr", "jr", "sr", "no", "vs",
    "blvd", "ave", "rd", "e.g", "i.e",
}
# fmt: on

VISITOR_FIELDS = {
    "question": {
        "type": "string",
        "description": "The visitor's question, word for word, in their language.",
    },
    "visitor_language_name": {"type": "string"},
    "visitor_language_code": {
        "type": "string",
        "description": "BCP 47 tag with the script where it matters, such as ar, es, zh-Hant, zh-Hans",
    },
}


def split_sentences(text: str) -> list[str]:
    """Split after . ! ? and their CJK forms, keeping abbreviations such as "St." whole."""
    # Latin punctuation ends a sentence only before a space; CJK punctuation needs none.
    pieces = re.split(r"(?<=[.!?])\s+|(?<=[。！？])\s*", text.strip())
    sentences = []
    for piece in pieces:
        previous_word = (
            sentences[-1].rsplit(" ", 1)[-1].rstrip(".").lower() if sentences else ""
        )
        if previous_word in ABBREVIATIONS:
            sentences[-1] += " " + piece
        elif piece:
            sentences.append(piece)
    return sentences


def official_codes(config: dict) -> list[str]:
    choice = config["languages"]["official"]
    if choice not in OFFICIAL:
        raise SystemExit("languages.official must be en, fr, or both")
    return OFFICIAL[choice]


def ordered_codes(config: dict, visitor_code: str) -> list[str]:
    """The languages each sentence is spoken in, in speaking order, without repeats."""
    official = official_codes(config)
    if not config["languages"]["include_visitor_language"] or visitor_code in official:
        return official
    if config["languages"]["order"] == "visitor_first":
        return [visitor_code, *official]
    return [*official, visitor_code]


def _instruction(
    config: dict, role: str, has_image: bool, spoken: bool, **values
) -> str:
    notes = []
    if has_image:
        notes.append(render_prompt(config, "image_note"))
    if spoken:
        notes.append(render_prompt(config, "question_spoken"))
    notes.append(render_prompt(config, role, values))
    return "\n\n".join(notes)


def answer(config: dict, record: RunRecord, question: list, image: list) -> dict:
    """Return {"question", "visitor", "codes", "groups"}; each group is [(code, sentence), ...]."""
    system = render_prompt(config, "system")
    spoken = any(not isinstance(part, str) for part in question)
    if config["answer"]["mode"] == "inline":
        return _answer_inline(config, record, system, question, image, spoken)
    return _answer_then_translate(config, record, system, question, image, spoken)


def _answer_then_translate(config, record, system, question, image, spoken):
    source = official_codes(config)[0]
    schema = {
        "type": "object",
        "properties": {**VISITOR_FIELDS, "answer": {"type": "string"}},
        "required": [*VISITOR_FIELDS, "answer"],
    }
    instruction = _instruction(
        config,
        "answer",
        bool(image),
        spoken,
        source_language=NAMES[source],
        max_characters=config["answer"]["max_characters"],
    )
    reply = json.loads(
        gemini.ask(
            config,
            record,
            system,
            instruction,
            image + question,
            schema,
            "gemini_answer",
        )
    )
    visitor = _visitor(reply)
    sentences = split_sentences(reply["answer"])
    codes = ordered_codes(config, visitor["code"])
    names = {**NAMES, visitor["code"]: visitor["name"]}
    translations = {source: sentences}
    others = [code for code in codes if code != source]
    if config["translation"]["backend"] == "argos" and others:
        # The visitor's full tag reaches Argos, so zh-Hant selects the Traditional model.
        targets = {c: visitor["tag"] if c == visitor["code"] else c for c in others}
        record.sent(
            "Argos", targets=", ".join(targets.values()), sentences="\n".join(sentences)
        )
        found, others = argos.translate_many(config, record, sentences, source, targets)
        translations.update(found)
        if config["translation"]["fallback"] != "gemini":
            others = []
    if others:
        schema = {
            "type": "object",
            "properties": {
                c: {"type": "array", "items": {"type": "string"}} for c in others
            },
            "required": others,
        }
        prompt = render_prompt(
            config,
            "translate_sentences",
            {
                "target_languages": ", ".join(f"{names[c]} (key {c})" for c in others),
                "sentences": "\n".join(
                    f"{i + 1}. {s}" for i, s in enumerate(sentences)
                ),
            },
        )
        translated = json.loads(
            gemini.ask(
                config, record, "", prompt, schema=schema, label="gemini_translate"
            )
        )
        translations.update(translated)
    return _result(reply, visitor, codes, translations, len(sentences), record)


def _answer_inline(config, record, system, question, image, spoken):
    official = official_codes(config)
    keys = [*official, "visitor"]
    schema = {
        "type": "object",
        "properties": {
            **VISITOR_FIELDS,
            "sentences": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {k: {"type": "string"} for k in keys},
                    "required": keys,
                },
            },
        },
        "required": [*VISITOR_FIELDS, "sentences"],
    }
    targets = ", ".join(f"{NAMES[c]} (key {c})" for c in official)
    instruction = _instruction(
        config,
        "answer_inline",
        bool(image),
        spoken,
        source_language=NAMES[official[0]],
        max_characters=config["answer"]["max_characters"],
        target_languages=targets + ", and the visitor's language (key visitor)",
    )
    reply = json.loads(
        gemini.ask(
            config,
            record,
            system,
            instruction,
            image + question,
            schema,
            "gemini_answer",
        )
    )
    visitor = _visitor(reply)
    codes = ordered_codes(config, visitor["code"])
    rows = reply["sentences"]
    translations = {c: [row[c] for row in rows] for c in official}
    translations[visitor["code"]] = [row["visitor"] for row in rows]
    return _result(reply, visitor, codes, translations, len(rows), record)


def _visitor(reply: dict) -> dict:
    tag = reply["visitor_language_code"]
    return {
        "name": reply["visitor_language_name"],
        "tag": tag,
        "code": tag.lower().replace("_", "-").split("-")[0],
    }


def _result(reply, visitor, codes, translations, count, record):
    mismatched = [c for c in codes if len(translations.get(c, [])) != count]
    if mismatched:
        # A translation list of the wrong length cannot be paired sentence by sentence.
        record.data["translation_mismatch"] = mismatched
        codes = [c for c in codes if c not in mismatched]
    groups = [[(c, translations[c][i]) for c in codes] for i in range(count)]
    return {
        "question": reply["question"],
        "visitor": visitor,
        "codes": codes,
        "groups": groups,
    }


def synthesize_in_order(config: dict, groups: list) -> Iterator[dict]:
    """Yield each sentence's audio in speaking order. Up to tts.parallel sentences synthesize at
    once, so later sentences are ready while earlier ones play."""
    pieces = [(g, code, text) for g, group in enumerate(groups) for code, text in group]
    # A language the voice model cannot speak is shown without audio; its official-language
    # partner in the same group is still spoken.
    spoken = set(config["elevenlabs"]["spoken_languages"])
    with ThreadPoolExecutor(config["tts"]["parallel"]) as pool:
        futures = [
            pool.submit(speech.convert, config, text, code) if code in spoken else None
            for _, code, text in pieces
        ]
        for (group, code, text), future in zip(pieces, futures, strict=True):
            waited = time.perf_counter()
            pcm, rate, first_ms, total_ms = (
                future.result() if future else (None, None, 0, 0)
            )
            yield {
                "group": group,
                "code": code,
                "text": text,
                "pcm": pcm,
                "rate": rate,
                "first_audio_ms": first_ms,
                "synth_ms": total_ms,
                "waited_ms": round((time.perf_counter() - waited) * 1000),
            }
