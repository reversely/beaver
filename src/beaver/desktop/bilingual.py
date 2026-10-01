"""Sentence-by-sentence replies in the official languages and the visitor's language.

Pipeline mode: Gemini answers once in the first official language, a local splitter cuts the
answer into sentences, and one batched Gemini request translates every sentence into every other
target language. Inline mode asks the answer call for every language at once, for comparison.
Either way the result is a list of sentence groups, each group holding one sentence per language.
"""

import json
import re

import argos
import cloudflare
import provider
from beaver.core.record import RunRecord
from beaver.core.sentences import group, split_sentences, synthesize_in_order, translate
from beaver.core.settings import render_prompt

# Re-exported for run.py and server.py, which call bilingual.synthesize_in_order.
__all__ = ["answer", "synthesize_in_order"]

OFFICIAL = {"en": ["en"], "fr": ["fr"], "both": ["en", "fr"]}
NAMES = {"en": "English", "fr": "French"}

VISITOR_FIELDS = {
    "question": {
        "type": "string",
        "description": "The visitor's question, word for word, in their language.",
    },
    "visitor_language_name": {
        "type": "string",
        "description": "The English name of the language the visitor used.",
    },
    "visitor_language_code": {
        "type": "string",
        "description": "BCP 47 tag with the script where it matters, such as ar, es, zh-Hant, zh-Hans",
    },
}


ANSWER_FIELD = {
    "type": "string",
    "description": "Only the reply to the question; never mention the visitor's language.",
}

# A sentence that addresses the visitor, names their language, and gives its code or "ISO" is a
# report of the language, which the schema asks for in its own fields; some models (Workers AI
# Llama 4 Scout, #68) also write it into the answer. Fixed words, so model output never sets the rule.
ADDRESSES_VISITOR = ("visitor", "visiteur", "you ", "you'", "vous")


def names_visitor_language(sentence: str, name: str, code: str) -> bool:
    """True for a sentence such as "The visitor spoke Spanish, es." or "Le visiteur parlait
    anglais, code en." that only reports the visitor's language. French names the language in
    French, so a French sentence counts by its verb or "langue" in place of the English name."""
    lower = sentence.lower()
    if not any(word in lower for word in ADDRESSES_VISITOR):
        return False
    named = bool(name) and name.lower() in lower
    french = ("visiteur" in lower or "vous" in lower) and (
        "parl" in lower or "langue" in lower
    )
    if not (named or french):
        return False
    return (
        "iso" in lower
        or re.search(rf"(?<![a-z]){re.escape(code.lower())}(?![a-z])", lower)
        is not None
    )


def drop_language_reports(sentences: list[str], visitor: dict) -> list[str]:
    return [
        s
        for s in sentences
        if not names_visitor_language(s, visitor["name"], visitor["code"])
    ]


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
        "properties": {**VISITOR_FIELDS, "answer": ANSWER_FIELD},
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
        provider.ask(
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
    sentences = drop_language_reports(split_sentences(reply["answer"]), visitor)
    codes = ordered_codes(config, visitor["code"])
    names = {**NAMES, visitor["code"]: visitor["name"]}
    translations = {source: sentences}
    others = [code for code in codes if code != source]
    if provider.is_cloudflare(config):
        # Workers AI m2m100 takes the base code; zh-Hant and zh-Hans both arrive as zh.
        translations.update(
            cloudflare.translate(config, record, sentences, source, others)
        )
        return _result(reply, visitor, codes, translations, len(sentences), record)
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
    translations.update(
        translate(config, record, sentences, {c: names[c] for c in others})
    )
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
                "description": "Only the reply to the question; never mention the visitor's language.",
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
        provider.ask(
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
    rows = [
        row
        for row in reply["sentences"]
        if not names_visitor_language(
            row.get(official[0], ""), visitor["name"], visitor["code"]
        )
    ]
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
    codes, groups = group(record, codes, translations, count)
    return {
        "question": reply["question"],
        "visitor": visitor,
        "codes": codes,
        "groups": groups,
    }
