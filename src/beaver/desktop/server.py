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
import subprocess
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import bilingual
import cloudflare
import devices
import notebooks
import provider
import rover_phone
from beaver.core import guard
from beaver.core.record import RunRecord
from beaver.core.settings import render_prompt

HERE = Path(__file__).parent

UI = HERE / "ui"
# The site (web/) is served at /, with its home page and demo, and this app's page at /app/.
SITE = HERE.parents[2] / "web"
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
    "provider": {"name": ("gemini", "cloudflare")},
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


# Whisper loads once, on the first spoken question, so a typed-only session never pays for it.
_transcriber = None
_transcriber_lock = threading.Lock()


def _transcribe(config: dict, wav: bytes) -> tuple[str | None, str, float]:
    global _transcriber
    with _transcriber_lock:
        if _transcriber is None:
            from beaver.core.transcribe import Transcriber

            _transcriber = Transcriber(config)
    return _transcriber.detect_and_transcribe(wav)


def ask_events(config: dict, payload: dict, transcribe=_transcribe):
    """Run one turn and yield its events."""
    record = RunRecord(config, "ui")
    start = time.perf_counter()
    try:
        question = _question(config, record, payload, transcribe)
        image = _image(record, payload)
        result = guard_answer(bilingual.answer(config, record, question, image), record)
        record.mark("text_ready", start)
        if provider.is_cloudflare(config):
            _publish_in_background(config, record, result)
        yield {
            "type": "question",
            "question": result["question"],
            "visitor": result["visitor"],
            "codes": result["codes"],
        }
        sentences = []
        voice = provider.voice(config)
        for piece in bilingual.synthesize_in_order(
            config, result["groups"], voice=voice
        ):
            if not sentences:
                record.mark("first_audio_ready", start)
            sentence = {k: v for k, v in piece.items() if k not in ("pcm", "rate")}
            sentences.append(sentence)
            audio = None
            if piece["pcm"] is not None:
                name = f"g{piece['group'] + 1}-{piece['code']}"
                # ElevenLabs returns PCM with its rate; Workers AI MeloTTS returns MP3 (rate None).
                if piece["rate"] is None:
                    name += ".mp3"
                    record.save_file(name, piece["pcm"])
                else:
                    name += ".wav"
                    record.save_file(
                        name, devices.pcm_to_wav(piece["pcm"], piece["rate"])
                    )
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


def _publish_in_background(config, record, result):
    """Show the guarded turn on every viewer of the session (#61) without delaying the first
    audio. A failure is noted in the run record; the turn still plays on this laptop."""

    def run():
        try:
            cloudflare.publish(config, result)
        except (SystemExit, Exception) as error:  # noqa: BLE001 -- viewers are optional
            record.data["publish_error"] = str(error)

    threading.Thread(target=run, daemon=True).start()


def _session_state(config: dict) -> dict:
    """The live session's viewer link and its QR code, when the Cloudflare provider is on."""
    if not provider.is_cloudflare(config):
        return {"link": None}
    link = cloudflare.viewer_link(config)
    if link is None:
        return {
            "link": None,
            "note": "Set BEAVER_AGENT_TOKEN in .env to share the session",
        }
    import segno

    return {
        "link": link,
        "qr_svg": segno.make(link, error="m").svg_inline(
            scale=3, border=4, dark="#2b1a14", light="#fffaf2"
        ),
    }


def _question(config, record, payload, transcribe):
    """The question as text with personal information replaced (beaver.core.guard), the same as
    on the rover. A spoken question is transcribed on this laptop first, so its audio never
    leaves it."""
    if payload.get("text"):
        heard = payload["text"]
    else:
        wav = base64.b64decode(payload["audio_wav"])
        record.save_file("question.wav", wav)
        with record.timed("transcribe"):
            language, heard, probability = transcribe(config, wav)
        record.data["detected_language"] = {
            "language": language,
            "probability": round(probability, 2),
        }
        if language is None:
            raise ValueError(
                "Beaver could not tell which language you spoke. Please ask again, or type it."
            )
    question, findings = guard.redact(heard.strip())
    if not question:
        raise ValueError("Beaver did not catch that. Please ask again.")
    record.data["question"] = question
    record.data["guard_question"] = [f.rule for f in findings]
    return [render_prompt(config, "typed_question", {"question": question})]


def guard_answer(result: dict, record) -> dict:
    """Replace personal information in every answer sentence before it is spoken or filed, and
    keep the guarded question rather than Gemini's copy of it. Records which rules fired, never
    the original text."""
    rules = []
    groups = []
    for group in result["groups"]:
        guarded = []
        for code, sentence in group:
            text, findings = guard.redact(sentence)
            rules += [f.rule for f in findings]
            guarded.append((code, text))
        groups.append(guarded)
    record.data["guard_reply"] = {"rules": rules}
    return {**result, "question": record.data["question"], "groups": groups}


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


def _page(base: Path, relative: str) -> Path | None:
    """A file under `base`, with a folder path meaning its index.html."""
    if relative == "" or relative.endswith("/"):
        relative += "index.html"
    return _inside(base, relative)


def _rover_state(state: dict) -> dict:
    """The Rover page's view of the phone server, with the address drawn as a QR code."""
    if state["address"]:
        import segno

        # Error correction M survives screen glare that L does not; 6 px per module keeps every
        # edge on a whole pixel, since the page shows the code at its drawn size.
        state["qr_svg"] = segno.make(state["address"], error="m").svg_inline(
            scale=6, border=4, dark="#2b1a14", light="#fffaf2"
        )
    return state


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
            elif path == "/api/place":
                import place

                self._json(HTTPStatus.OK, place.last(app.config) or {})
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
            elif path == "/api/session":
                self._json(HTTPStatus.OK, _session_state(app.snapshot()))
            elif path == "/api/rover":
                self._rover(rover_phone.status)
            elif path.startswith("/runs/"):
                self._file(_inside(runs, path.removeprefix("/runs/")))
            elif path == "/app":
                self.send_response(HTTPStatus.MOVED_PERMANENTLY)
                self.send_header("Location", "/app/")
                self.end_headers()
            elif path.startswith("/app/"):
                self._file(_page(UI, path.removeprefix("/app/")))
            else:
                self._file(_page(SITE, path.lstrip("/")))

        def _local(self) -> bool:
            """A request this laptop's own page sent: to this server's own host name, which a
            DNS-rebinding page cannot claim, and, for a POST, with the X-Beaver header, which a
            cross-site form cannot send and a cross-site script cannot add without a preflight
            this server never answers."""
            port = self.server.server_address[1]
            host_ok = self.headers.get("Host") in (
                f"127.0.0.1:{port}",
                f"localhost:{port}",
            )
            return host_ok and (
                self.command == "GET" or self.headers.get("X-Beaver") == "1"
            )

        def _rover(self, action):
            if not self._local():
                self._json(
                    HTTPStatus.FORBIDDEN, {"error": "rover control is local only"}
                )
                return
            try:
                self._json(HTTPStatus.OK, _rover_state(action(app.config)))
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
                # An unreachable rover is a state the panel shows, not a failed request.
                detail = (getattr(error, "stderr", "") or "").strip()
                print(f"Rover not reachable over SSH: {detail or error}")
                self._json(
                    HTTPStatus.OK,
                    {
                        "state": "unreachable",
                        "address": None,
                        "error": None,
                        "note": None,
                    },
                )

        def do_POST(self):
            if self.path == "/api/rover/start":
                self._rover(rover_phone.start)
                return
            if self.path == "/api/rover/stop":
                self._rover(rover_phone.stop)
                return
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
    print(
        f"Beaver is running at http://127.0.0.1:{port}, with the app at "
        f"http://127.0.0.1:{port}/app/ (Ctrl-C stops it)"
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
