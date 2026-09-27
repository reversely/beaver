"""Pull the rover's turns from the Pi and file them into this app's notebooks.

The rover saves every turn to its own run folder and never waits on this app, so its runs folder
is the outbox. This app pulls new folders over SSH with rsync (the Pi cannot open connections back
to the laptop), transcribes each spoken question with one Gemini call, and files the exchange with
notebooks.file_exchange, the same path its own exchanges take. A filed.json marker in each pulled
folder keeps a turn from being filed twice; anything that fails is retried on the next pass.
"""

import json
import subprocess
import threading
import time
from pathlib import Path

import notebooks
from beaver.core import gemini
from beaver.core.record import RunRecord
from beaver.core.settings import render_prompt

HERE = Path(__file__).parent

# Only what filing needs; the rover's reply audio stays on the rover.
PULLED = ["record.json", "question.wav", "frame.jpg"]
LANGUAGE_CODES = {"English": "en", "French": "fr"}

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


def pull(config: dict) -> None:
    settings = config["sync"]
    local = _local_dir(config)
    local.mkdir(exist_ok=True)
    filters = ["--include=*/", *(f"--include={name}" for name in PULLED), "--exclude=*"]
    subprocess.run(
        [
            "rsync",
            "-a",
            "-e",
            f"ssh -o BatchMode=yes -o ConnectTimeout={settings['connect_timeout_seconds']}",
            *filters,
            f"{settings['host']}:{settings['remote_runs']}/",
            f"{local}/",
        ],
        check=True,
        capture_output=True,
        text=True,
    )


def _pending(config: dict) -> list:
    """Pulled turns that were answered from question audio and are not filed yet, oldest first."""
    turns = []
    for folder in sorted(_local_dir(config).iterdir()):
        if (folder / "filed.json").exists() or not (folder / "question.wav").exists():
            continue
        record_path = folder / "record.json"
        if not record_path.exists():
            continue
        rover = json.loads(record_path.read_text())
        if rover.get("reply") and not rover.get("error"):
            turns.append((folder, rover))
    return turns


def _file_turn(config: dict, folder, rover: dict) -> dict:
    record = RunRecord(config, "rover")
    record.data["rover_run"] = folder.name
    wav = (folder / "question.wav").read_bytes()
    heard = json.loads(
        gemini.ask(
            config,
            record,
            "",
            render_prompt(config, "rover_question"),
            [(wav, "audio/wav", f"{folder.name}/question.wav: rover question audio")],
            schema=QUESTION_SCHEMA,
            label="gemini_rover_question",
        )
    )
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
