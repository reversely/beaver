"""Route each exchange into a review notebook: vocabulary, concepts, and dated moments.

Notebooks live in one JSON file (gitignored). Each holds a title in English and French, a theme,
a span of years, and the entries added by every exchange filed into it.
"""

import json
import threading
import uuid
from datetime import UTC, datetime
from pathlib import Path

from beaver.core import gemini
from beaver.core.record import RunRecord
from beaver.core.settings import render_prompt

HERE = Path(__file__).parent

THEMES = ["civic", "history", "culture", "language"]
# The pieces in ui/artifact-specs.js; tests/artifacts.test.mjs checks the two lists match.
PIECES = [
    "peace_tower",
    "north_canoe",
    "poutine",
    "open_book",
    "easel_jack_pine",
    "flag",
    "hockey",
    "loonie",
]
_lock = threading.Lock()

SCHEMA = {
    "type": "object",
    "properties": {
        "notebook": {
            "type": "object",
            "properties": {
                "id": {
                    "type": "string",
                    "description": "An existing id, or empty for new",
                },
                "title_en": {"type": "string"},
                "title_fr": {"type": "string"},
                "theme": {"type": "string", "enum": THEMES},
                "artifact": {"type": "string", "enum": PIECES},
                "year_start": {"type": "integer"},
                "year_end": {"type": "integer"},
            },
            "required": [
                "id",
                "title_en",
                "title_fr",
                "theme",
                "artifact",
                "year_start",
                "year_end",
            ],
        },
        "vocabulary": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "en": {"type": "string"},
                    "fr": {"type": "string"},
                    "visitor": {"type": "string"},
                    "meaning": {"type": "string"},
                },
                "required": ["en", "fr", "visitor", "meaning"],
            },
        },
        "concepts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "summary": {"type": "string"},
                    "why_it_matters": {"type": "string"},
                },
                "required": ["title", "summary", "why_it_matters"],
            },
        },
        "moments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "year": {"type": "integer"},
                    "event": {"type": "string"},
                },
                "required": ["year", "event"],
            },
        },
    },
    "required": ["notebook", "vocabulary", "concepts", "moments"],
}


def _path(config: dict):
    return HERE / config["notebooks"]["store"]


def load(config: dict) -> list[dict]:
    path = _path(config)
    return json.loads(path.read_text()) if path.exists() else []


def _save(config: dict, notebooks: list[dict]) -> None:
    path = _path(config)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(notebooks, indent=2, ensure_ascii=False))
    temporary.replace(path)


def summaries(notebooks: list[dict]) -> list[dict]:
    return [
        {
            "id": n["id"],
            "title_en": n["title_en"],
            "title_fr": n["title_fr"],
            "theme": n["theme"],
            "artifact": n.get("artifact"),
            "year_start": n["year_start"],
            "year_end": n["year_end"],
            "entries": len(n["entries"]),
        }
        for n in notebooks
    ]


def file_exchange(config: dict, record: RunRecord, result: dict) -> dict:
    """Ask Gemini where this exchange belongs, store it, and return the notebook summary."""
    settings = config["notebooks"]
    existing = load(config)
    listing = "\n".join(
        f"- id {n['id']}: {n['title_en']} ({n['theme']}, {n['year_start']}-{n['year_end']})"
        for n in existing
    )
    source = result["codes"][0]
    answer = " ".join(
        text for group in result["groups"] for code, text in group if code == source
    )
    prompt = render_prompt(
        config,
        "notebook",
        {
            "max_vocabulary": settings["max_vocabulary"],
            "max_concepts": settings["max_concepts"],
            "visitor_language": result["visitor"]["name"],
            "notebooks": listing or "(none yet)",
            "question": result["question"],
            "answer": answer,
        },
    )
    reply = json.loads(
        gemini.ask(config, record, "", prompt, schema=SCHEMA, label="gemini_notebook")
    )
    entry = {
        "at": datetime.now(UTC).isoformat(timespec="seconds"),
        "run": record.dir.name,
        "question": result["question"],
        "visitor_language": result["visitor"],
        "answer": answer,
        "vocabulary": reply["vocabulary"][: settings["max_vocabulary"]],
        "concepts": reply["concepts"][: settings["max_concepts"]],
        "moments": reply["moments"],
        # "desktop" for this app's own exchanges, "rover" for turns pulled from the Pi.
        "source": result.get("source", "desktop"),
    }
    chosen = reply["notebook"]
    with _lock:
        notebooks = load(config)
        notebook = next((n for n in notebooks if n["id"] == chosen["id"]), None)
        if notebook is None:
            notebook = {
                "id": uuid.uuid4().hex[:8],
                **{k: chosen[k] for k in ("title_en", "title_fr", "theme")},
                "year_start": chosen["year_start"],
                "year_end": chosen["year_end"],
                "entries": [],
            }
            notebooks.append(notebook)
        # The schema's enum constrains Gemini; this check keeps an unlisted name out of the store.
        if chosen["artifact"] in PIECES and not notebook.get("artifact"):
            notebook["artifact"] = chosen["artifact"]
        years = [m["year"] for m in entry["moments"]]
        if years:
            notebook["year_start"] = min(notebook["year_start"], *years)
            notebook["year_end"] = max(notebook["year_end"], *years)
        notebook["entries"].append(entry)
        _save(config, notebooks)
    record.data["notebook"] = {
        "id": notebook["id"],
        "new": chosen["id"] != notebook["id"],
    }
    return summaries([notebook])[0]


def pick_missing_pieces(config: dict, record: RunRecord) -> dict:
    """Ask Gemini once for a piece for every notebook that has none; return {id: piece}."""
    with _lock:
        notebooks = load(config)
    missing = [n for n in notebooks if n.get("artifact") not in PIECES]
    if not missing:
        return {}
    listing = "\n".join(
        f"- id {n['id']}: {n['title_en']} ({n['theme']})" for n in missing
    )
    schema = {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "artifact": {"type": "string", "enum": PIECES},
            },
            "required": ["id", "artifact"],
        },
    }
    prompt = render_prompt(config, "pick_pieces", {"notebooks": listing})
    picks = json.loads(
        gemini.ask(config, record, "", prompt, schema=schema, label="gemini_pieces")
    )
    chosen = {p["id"]: p["artifact"] for p in picks if p["artifact"] in PIECES}
    with _lock:
        notebooks = load(config)
        for notebook in notebooks:
            if notebook["id"] in chosen and notebook.get("artifact") not in PIECES:
                notebook["artifact"] = chosen[notebook["id"]]
        _save(config, notebooks)
    return chosen
