"""Open-source translation with Argos Translate model packages, run on CTranslate2.

An Argos package holds an OPUS-MT model converted for CTranslate2 plus its SentencePiece model.
This module downloads packages from the Argos index, loads them without the argostranslate
library (which pulls in PyTorch through stanza), and translates lists of sentences that
bilingual.py has already split. Pairs without a direct model pivot through English.
"""

import io
import json
import time
import urllib.request
import zipfile
from collections import OrderedDict
from pathlib import PurePosixPath

from settings import HERE

INDEX_URL = (
    "https://raw.githubusercontent.com/argosopentech/argospm-index/main/index.json"
)

# BCP 47 tags whose Argos code differs from the base language code.
ARGOS_CODES = {"zh-hant": "zt", "zh-tw": "zt", "zh-hk": "zt", "pt-br": "pb"}


class MissingModel(Exception):
    """No installed model, direct or through English, covers a language pair."""


def argos_code(tag: str) -> str:
    tag = tag.lower().replace("_", "-")
    return ARGOS_CODES.get(tag, tag.split("-")[0])


def models_dir(config: dict):
    return HERE / config["translation"]["models_dir"]


def installed(config: dict) -> set[tuple[str, str]]:
    root = models_dir(config)
    if not root.exists():
        return set()
    return {
        tuple(d.name.split("_", 1))
        for d in root.iterdir()
        if (d / "model" / "model.bin").exists()
    }


# ---- Download ------------------------------------------------------------------------------------


def _fetch(url: str) -> bytes:
    if not url.startswith("https://"):
        raise ValueError(f"refusing a non-HTTPS download: {url}")
    request = urllib.request.Request(url, headers={"User-Agent": "beaver-experiment"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def download(config: dict, codes: list[str]) -> list[str]:
    """Download en<->code packages for each code; return the pairs installed."""
    index = json.loads(_fetch(INDEX_URL))
    wanted = {argos_code(c) for c in codes} - {"en"}
    pairs = [
        p
        for p in index
        if {p["from_code"], p["to_code"]} & wanted
        and "en" in (p["from_code"], p["to_code"])
    ]
    done = []
    for package in pairs:
        name = f"{package['from_code']}_{package['to_code']}"
        target = models_dir(config) / name
        if (target / "model" / "model.bin").exists():
            done.append(f"{name} (already installed)")
            continue
        archive = zipfile.ZipFile(io.BytesIO(_fetch(package["links"][0])))
        _extract(archive, target)
        done.append(f"{name} {package['package_version']}")
    missing = wanted - {p["from_code"] for p in pairs} - {p["to_code"] for p in pairs}
    done += [f"{code}: no Argos package" for code in sorted(missing)]
    return done


def _extract(archive: zipfile.ZipFile, target) -> None:
    """Extract the model, SentencePiece model, metadata, and README; skip the stanza folder.
    Every member path must stay inside `target`."""
    target.mkdir(parents=True, exist_ok=True)
    root = target.resolve()
    for member in archive.infolist():
        parts = PurePosixPath(member.filename).parts[1:]
        if not parts or member.is_dir() or parts[0] == "stanza":
            continue
        destination = (target / PurePosixPath(*parts)).resolve()
        if not destination.is_relative_to(root):
            raise ValueError(
                f"archive member escapes the model folder: {member.filename}"
            )
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(archive.read(member))


# ---- Translation ---------------------------------------------------------------------------------

# Loaded models, least recently used first; translation.max_loaded caps the count.
_loaded: OrderedDict = OrderedDict()


def _model(config: dict, pair: tuple[str, str]):
    import ctranslate2
    import sentencepiece

    if pair in _loaded:
        _loaded.move_to_end(pair)
        return _loaded[pair]
    settings = config["translation"]
    folder = models_dir(config) / f"{pair[0]}_{pair[1]}"
    translator = ctranslate2.Translator(
        str(folder / "model"),
        device="cpu",
        compute_type=settings["compute_type"],
        intra_threads=settings["threads"],
    )
    tokenizer = sentencepiece.SentencePieceProcessor(
        model_file=str(folder / "sentencepiece.model")
    )
    _loaded[pair] = (translator, tokenizer)
    while len(_loaded) > settings["max_loaded"]:
        _loaded.popitem(last=False)
    return _loaded[pair]


def route(config: dict, source: str, target: str) -> list[tuple[str, str]]:
    """The model pairs that carry source to target: direct, or through English."""
    have = installed(config)
    if (source, target) in have:
        return [(source, target)]
    if (source, "en") in have and ("en", target) in have:
        return [(source, "en"), ("en", target)]
    raise MissingModel(f"no Argos model covers {source} to {target}")


def translate(
    config: dict, sentences: list[str], source_tag: str, target_tag: str
) -> list[str]:
    source, target = argos_code(source_tag), argos_code(target_tag)
    beam = config["translation"]["beam_size"]
    for pair in route(config, source, target):
        translator, tokenizer = _model(config, pair)
        tokens = tokenizer.encode(sentences, out_type=str)
        results = translator.translate_batch(
            tokens, beam_size=beam, max_decoding_length=256
        )
        # Hypotheses come back as SentencePiece pieces; "▁" marks a word start.
        sentences = [
            "".join(r.hypotheses[0]).replace("▁", " ").strip() for r in results
        ]
    return sentences


def translate_many(
    config: dict, record, sentences: list[str], source_tag: str, targets: dict
) -> tuple[dict, list]:
    """Translate into each {code: tag} target; return (translations by code, codes left over)."""
    translations, missing = {}, []
    start = time.perf_counter()
    for code, tag in targets.items():
        try:
            translations[code] = translate(config, sentences, source_tag, tag)
        except MissingModel:
            missing.append(code)
    record.mark("argos_translate", start)
    record.data["argos_models"] = {
        "loaded": [f"{a}_{b}" for a, b in _loaded],
        "missing": missing,
    }
    return translations, missing
