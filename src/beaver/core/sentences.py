"""Answers as sentence groups in several languages, shared by the desktop app and the rover.

An answer is split into sentences, one batched Gemini request translates every sentence into every
other language, and each group holds one sentence per language. Synthesis runs a few sentences
ahead of playback, so later sentences are ready while earlier ones play.
"""

import json
import re
import time
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor

from beaver.core import gemini, speech
from beaver.core.record import RunRecord
from beaver.core.settings import render_prompt

# Abbreviations that end in a period but do not end a sentence.
# fmt: off
ABBREVIATIONS = {
    "st", "ste", "mt", "ft", "mr", "mrs", "ms", "dr", "jr", "sr", "no", "vs",
    "blvd", "ave", "rd", "e.g", "i.e",
}
# fmt: on


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


def translate(
    config: dict, record: RunRecord, sentences: list[str], targets: dict[str, str]
) -> dict[str, list[str]]:
    """Translate every sentence into every target in one Gemini request. `targets` maps each
    result key to the language's English name; the result maps each key to its sentences."""
    if not targets:
        return {}
    schema = {
        "type": "object",
        "properties": {
            code: {"type": "array", "items": {"type": "string"}} for code in targets
        },
        "required": list(targets),
    }
    prompt = render_prompt(
        config,
        "translate_sentences",
        {
            "target_languages": ", ".join(
                f"{name} (key {code})" for code, name in targets.items()
            ),
            "sentences": "\n".join(f"{i + 1}. {s}" for i, s in enumerate(sentences)),
        },
    )
    return json.loads(
        gemini.ask(config, record, "", prompt, schema=schema, label="gemini_translate")
    )


def group(
    record: RunRecord, codes: list[str], translations: dict[str, list[str]], count: int
) -> tuple[list[str], list[list[tuple[str, str]]]]:
    """Pair the sentences by position: (codes kept, groups). A language whose list has the wrong
    length cannot be paired sentence by sentence, so it is dropped and noted in the record."""
    mismatched = [c for c in codes if len(translations.get(c, [])) != count]
    if mismatched:
        record.data["translation_mismatch"] = mismatched
        codes = [c for c in codes if c not in mismatched]
    return codes, [[(c, translations[c][i]) for c in codes] for i in range(count)]


def synthesize_in_order(
    config: dict,
    groups: list,
    spoken_codes: set[str] | None = None,
    voice: tuple | None = None,
) -> Iterator[dict]:
    """Yield each sentence's audio in speaking order. Up to tts.parallel sentences synthesize at
    once, so later sentences are ready while earlier ones play. `voice` is (convert function,
    languages it speaks) and defaults to ElevenLabs. A language the voice does not speak, or
    outside `spoken_codes` when given, is yielded without audio."""
    pieces = [(g, code, text) for g, group in enumerate(groups) for code, text in group]
    convert, spoken = voice or (
        speech.convert,
        set(config["elevenlabs"]["spoken_languages"]),
    )
    if spoken_codes is not None:
        spoken = spoken & spoken_codes
    with ThreadPoolExecutor(config["tts"]["parallel"]) as pool:
        futures = [
            pool.submit(convert, config, text, code) if code in spoken else None
            for _, code, text in pieces
        ]
        for (group_index, code, text), future in zip(pieces, futures, strict=True):
            waited = time.perf_counter()
            pcm, rate, first_ms, total_ms = (
                future.result() if future else (None, None, 0, 0)
            )
            yield {
                "group": group_index,
                "code": code,
                "text": text,
                "pcm": pcm,
                "rate": rate,
                "first_audio_ms": first_ms,
                "synth_ms": total_ms,
                "waited_ms": round((time.perf_counter() - waited) * 1000),
            }
