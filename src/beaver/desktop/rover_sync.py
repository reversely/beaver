"""Pull the rover's turns from the Pi and file them into this app's notebooks.

The rover saves every turn to its own run folder and never waits on this app, so its runs folder
is the outbox. This app pulls new folders over SSH with rsync (the Pi cannot open connections back
to the laptop) and files each exchange with notebooks.file_exchange, the same path its own
exchanges take. The rover transcribes and redacts each question on board, so a turn is filed from
the redacted question in its record.json and its audio stays on the Pi. A turn saved before
on-board transcription has only its question audio, which one Gemini call transcribes. A filed.json
marker in each pulled folder keeps a turn from being filed twice; anything that fails is retried on
the next pass.
"""

import json
import subprocess
import threading
import time
from pathlib import Path

import notebooks
from beaver.core import gemini
from beaver.core.languages import LANGUAGES
from beaver.core.record import RunRecord
from beaver.core.settings import render_prompt

HERE = Path(__file__).parent

# Only what filing needs; the rover's reply audio stays on the rover.
PULLED = ["record.json", "frame.jpg"]
# Pulled only for turns saved before the rover transcribed on board.
LEGACY_AUDIO = "question.wav"
LANGUAGE_CODES = {"English": "en", "French": "fr"}
AUTO = "auto"

QUESTION_SCHEMA = {
    "type": "object",
    "properties": {
        "question": {"type": "string"},
        "language_name": {"type": "string"},
        "language_code": {"type": "string"},
    },
    "required": ["question", "language_name", "language_code"],
}


def _local_dir(config: dict):
    return HERE / config["sync"]["local_dir"]


def _rsync(config: dict, *filters: str) -> None:
    settings = config["sync"]
    subprocess.run(
        [
            "rsync",
            "-a",
            "-e",
            f"ssh -o BatchMode=yes -o ConnectTimeout={settings['connect_timeout_seconds']}",
            *filters,
            f"{settings['host']}:{settings['remote_runs']}/",
            f"{_local_dir(config)}/",
        ],
        check=True,
        capture_output=True,
        text=True,
    )


def _is_legacy(rover: dict) -> bool:
    """Saved before on-board transcription, which records the phone page's language choice."""
    return "question_language" not in rover


def _read_record(folder) -> dict | None:
    """The folder's record, or None when it has none or the rover lost power while writing it."""
    try:
        return json.loads((folder / "record.json").read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def _unfiled(config: dict) -> list:
    """Pulled turns with a readable record and no filed.json, oldest first."""
    turns = []
    for folder in sorted(_local_dir(config).iterdir()):
        rover = _read_record(folder)
        if rover is not None and not (folder / "filed.json").exists():
            turns.append((folder, rover))
    return turns


def pull(config: dict) -> None:
    """Pull records and frames, then question audio only for unfiled turns saved before on-board
    transcription. A question audio file pulled for a newer turn by an earlier sync is removed."""
    _local_dir(config).mkdir(exist_ok=True)
    _rsync(config, "--include=*/", *(f"--include={n}" for n in PULLED), "--exclude=*")
    legacy = []
    for folder, rover in _unfiled(config):
        if _is_legacy(rover):
            legacy += [f"{folder.name}/", f"{folder.name}/{LEGACY_AUDIO}"]
    for audio in _local_dir(config).glob(f"*/{LEGACY_AUDIO}"):
        rover = _read_record(audio.parent)
        if rover is not None and not _is_legacy(rover):
            audio.unlink()
    if legacy:
        # Include filters, because macOS openrsync has no --ignore-missing-args; a typed turn has
        # no question audio and the filter matches nothing.
        _rsync(config, *(f"--include={path}" for path in legacy), "--exclude=*")


def _language(rover: dict) -> str | None:
    """The code the rover transcribed in: the page's choice, or the one it detected."""
    language = rover.get("question_language")
    if language == AUTO:
        language = (rover.get("detected_language") or {}).get("language")
    return language if language in LANGUAGES else None


def _pending(config: dict) -> list:
    """Unfiled turns the rover answered: newer ones with a redacted question and a language, and
    older ones with question audio. A turn where the rover asked the visitor to try again is not
    an exchange and is never filed."""
    turns = []
    for folder, rover in _unfiled(config):
        if not rover.get("reply") or rover.get("error"):
            continue
        if _is_legacy(rover):
            ready = (folder / LEGACY_AUDIO).exists()
        else:
            ready = bool(rover.get("question")) and _language(rover) is not None
        if ready:
            turns.append((folder, rover))
    return turns


def _transcribe_legacy(config: dict, record, folder) -> dict:
    wav = (folder / LEGACY_AUDIO).read_bytes()
    return json.loads(
        gemini.ask(
            config,
            record,
            "",
            render_prompt(config, "rover_question"),
            [(wav, "audio/wav", f"{folder.name}/{LEGACY_AUDIO}: rover question audio")],
            schema=QUESTION_SCHEMA,
            label="gemini_rover_question",
        )
    )


def _file_turn(config: dict, folder, rover: dict) -> dict:
    record = RunRecord(config, "rover")
    record.data["rover_run"] = folder.name
    if _is_legacy(rover):
        heard = _transcribe_legacy(config, record, folder)
    else:
        code = _language(rover)
        heard = {
            "question": rover["question"],
            "language_name": LANGUAGES[code],
            "language_code": code,
        }
    reply_language = rover["config"]["prompt_vars"]["answer_language"]
    code = LANGUAGE_CODES.get(reply_language, "en")
    result = {
        "question": heard["question"],
        "visitor": {"name": heard["language_name"], "code": heard["language_code"]},
        "codes": [code],
        "groups": [[(code, rover["reply"])]],
        "source": "rover",
    }
    summary = notebooks.file_exchange(config, record, result)
    record.finish(reply=rover["reply"], question=heard)
    (folder / "filed.json").write_text(
        json.dumps({"notebook": summary["id"], "desktop_run": record.dir.name})
    )
    return summary


def _latest_location(config: dict) -> tuple[dict, str] | None:
    """The rounded location in the newest pulled record that has one, with its run folder name."""
    for folder in sorted(_local_dir(config).iterdir(), reverse=True):
        record_path = folder / "record.json"
        if record_path.exists():
            location = json.loads(record_path.read_text()).get("location")
            if location:
                return location, folder.name
    return None


def update_place(config: dict) -> None:
    """Map the rover's newest location to a province and municipality, on this laptop only."""
    import place

    latest = _latest_location(config)
    known = place.last(config)
    if latest is None or (known and known["rover_run"] == latest[1]):
        return
    try:
        place.remember(config, latest[0], latest[1])
    except SystemExit as error:  # the boundary file is not downloaded yet
        print(f"Phone location not mapped: {error}")


def sync_once(config: dict) -> dict:
    """Pull, then file every pending turn. Returns counts; a failed turn is left for next time."""
    pull(config)
    update_place(config)
    filed, failed = 0, 0
    for folder, rover in _pending(config):
        try:
            _file_turn(config, folder, rover)
            filed += 1
        except (SystemExit, Exception) as error:  # noqa: BLE001 -- retried on the next pass
            failed += 1
            print(f"Could not file rover turn {folder.name}: {error}")
    return {"filed": filed, "failed": failed}


def start_background(config: dict) -> None:
    """Sync every interval while the desktop app serves. An unreachable rover waits a pass."""
    interval = config["sync"]["interval_seconds"]

    def loop():
        while True:
            try:
                result = sync_once(config)
                if result["filed"] or result["failed"]:
                    print(
                        f"Rover sync: {result['filed']} filed, {result['failed']} failed"
                    )
            except subprocess.CalledProcessError as error:
                print(f"Rover sync skipped: {error.stderr.strip() or error}")
            time.sleep(interval)

    threading.Thread(target=loop, daemon=True, name="rover-sync").start()
