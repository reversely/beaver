"""Local web interface: a question goes in, sentence groups stream back as they are spoken.

POST /api/ask streams newline-delimited JSON events, so the page can play the first sentence while
later ones are still being synthesized:
  {"type": "question", ...}  the transcript, the visitor's language, and the languages spoken
  {"type": "sentence", ...}  one sentence's text, language, group, and audio URL
  {"type": "done", ...}      the run's timings
  {"type": "error", ...}     a message naming what failed
"""

import base64
import copy
import json
import mimetypes
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import bilingual
import devices
import notebooks
from beaver.core.record import RunRecord
from beaver.core.settings import render_prompt

HERE = Path(__file__).parent

UI = HERE / "ui"
# Settings changed on the page; gitignored, applied over config.toml at startup.
LOCAL_SETTINGS = HERE / "settings.local.json"
# Each setting the page may change, with the values it accepts.
EDITABLE = {
    "languages": {
        "official": ("en", "fr", "both"),
        "include_visitor_language": (True, False),
        "order": ("official_first", "visitor_first"),
    },
    "answer": {"mode": ("translate", "inline")},
    "translation": {"backend": ("gemini", "argos")},
}
MAX_REQUEST_BYTES = 15 * 1024 * 1024


class App:
    def __init__(self, config: dict):
        self.config = config
        self.lock = threading.Lock()
        if LOCAL_SETTINGS.exists():
            self.apply(json.loads(LOCAL_SETTINGS.read_text()))

    def settings(self) -> dict:
        with self.lock:
            return {
                s: {k: self.config[s][k] for k in keys} for s, keys in EDITABLE.items()
            }

    def apply(self, changes: dict) -> None:
        """Validate every change first, then write them all; a rejected request changes nothing."""
        updates = []
        for section, values in changes.items():
            for key, value in values.items():
                allowed = EDITABLE.get(section, {}).get(key)
                if allowed is None:
                    raise ValueError(f"{section}.{key} is not editable")
                # Type-strict, so 1 is not accepted as True.
                if not any(type(value) is type(a) and value == a for a in allowed):
                    raise ValueError(
                        f"{section}.{key} must be one of {sorted(map(str, allowed))}"
                    )
                updates.append((section, key, value))
        with self.lock:
            for section, key, value in updates:
                self.config[section][key] = value

    def snapshot(self) -> dict:
        """A private copy per request, so a settings change never alters a turn midway."""
        with self.lock:
            return copy.deepcopy(self.config)


def ask_events(config: dict, payload: dict):
    """Run one turn and yield its events."""
    record = RunRecord(config, "ui")
    start = time.perf_counter()
    try:
        question = _question(config, record, payload)
        image = _image(record, payload)
        result = bilingual.answer(config, record, question, image)
        record.mark("text_ready", start)
        yield {
            "type": "question",
            "question": result["question"],
            "visitor": result["visitor"],
            "codes": result["codes"],
        }
        sentences = []
        for piece in bilingual.synthesize_in_order(config, result["groups"]):
            if not sentences:
                record.mark("first_audio_ready", start)
            sentence = {k: v for k, v in piece.items() if k not in ("pcm", "rate")}
            sentences.append(sentence)
            audio = None
            if piece["pcm"] is not None:
                name = f"g{piece['group'] + 1}-{piece['code']}.wav"
                record.save_file(name, devices.pcm_to_wav(piece["pcm"], piece["rate"]))
                audio = f"/runs/{record.dir.name}/{name}"
            yield {
                "type": "sentence",
                **sentence,
                "audio": audio,
            }
        record.mark("all_synthesized", start)
        record.data["sentences"] = sentences
        if config["notebooks"]["enabled"]:
            # After every sentence is synthesized, so filing never delays the first audio.
            try:
                yield {
                    "type": "notebook",
                    **notebooks.file_exchange(config, record, result),
                }
            except (SystemExit, Exception) as error:  # noqa: BLE001 -- the reply already played
                record.data["notebook_error"] = str(error)
                yield {"type": "notebook_error", "message": str(error)}
        record.finish(reply="see sentences")
        yield {
            "type": "done",
            "timings_ms": record.data["timings_ms"],
            "run": record.dir.name,
        }
    except (SystemExit, Exception) as error:  # noqa: BLE001 -- any failure must reach the page
        message = str(error) or type(error).__name__
        record.finish(error=f"{type(error).__name__}: {message}")
        yield {"type": "error", "message": message}


def _question(config, record, payload):
    if payload.get("text"):
        return [render_prompt(config, "typed_question", {"question": payload["text"]})]
    wav = base64.b64decode(payload["audio_wav"])
    path = record.save_file("question.wav", wav)
    return [
        (
            wav,
            "audio/wav",
            f"{path.name}: {len(wav) // 1024} KB of browser microphone audio",
        )
    ]


def _image(record, payload):
    if not payload.get("image_jpeg"):
        return []
    jpeg = base64.b64decode(payload["image_jpeg"])
    path = record.save_file("frame.jpg", jpeg)
    return [
        (
            jpeg,
            "image/jpeg",
            f"{path.name}: {len(jpeg) // 1024} KB browser camera frame",
        )
    ]


def _inside(base: Path, relative: str) -> Path | None:
    """Resolve `relative` under `base`, or None when it would escape `base`."""
    path = (base / relative).resolve()
    return path if path.is_file() and path.is_relative_to(base.resolve()) else None


def make_handler(app: App):
    runs = HERE / app.config["output"]["runs_dir"]

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass

        def _json(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _file(self, path: Path | None):
            if path is None:
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            data = path.read_bytes()
            self.send_response(HTTPStatus.OK)
            kind = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def _body(self):
            length = int(self.headers.get("Content-Length", 0))
            if length > MAX_REQUEST_BYTES:
                raise ValueError("request too large")
            return json.loads(self.rfile.read(length) or b"{}")

        def do_GET(self):
            path = self.path.split("?")[0]
            if path == "/api/settings":
                self._json(HTTPStatus.OK, app.settings())
            elif path == "/api/notebooks":
                self._json(
                    HTTPStatus.OK, notebooks.summaries(notebooks.load(app.config))
                )
            elif path.startswith("/api/notebooks/"):
                wanted = path.removeprefix("/api/notebooks/")
                found = [n for n in notebooks.load(app.config) if n["id"] == wanted]
                if found:
                    self._json(HTTPStatus.OK, found[0])
                else:
                    self.send_error(HTTPStatus.NOT_FOUND)
            elif path.startswith("/runs/"):
                self._file(_inside(runs, path.removeprefix("/runs/")))
            else:
                self._file(_inside(UI, path.lstrip("/") or "index.html"))

        def do_POST(self):
            try:
                payload = self._body()
            except ValueError as error:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            if self.path == "/api/settings":
                try:
                    app.apply(payload)
                except (ValueError, SystemExit) as error:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                    return
                LOCAL_SETTINGS.write_text(json.dumps(app.settings(), indent=2))
                self._json(HTTPStatus.OK, app.settings())
            elif self.path == "/api/ask":
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "application/x-ndjson")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                for event in ask_events(app.snapshot(), payload):
                    self.wfile.write(
                        json.dumps(event, ensure_ascii=False).encode() + b"\n"
                    )
                    self.wfile.flush()
            else:
                self.send_error(HTTPStatus.NOT_FOUND)

    return Handler


def serve(config: dict, port: int) -> None:
    app = App(config)
    if config["sync"]["enabled"]:
        from rover_sync import start_background

        start_background(config)
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(app))
    print(f"Beaver is running at http://127.0.0.1:{port} (Ctrl-C stops it)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
