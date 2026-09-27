"""Serve the phone page, pass each recorded question to the rover, and open the tunnel to it.

The phone's browser records the question, and the Pi answers through its own camera and speaker.
Every request except the page's script and style must carry the session token from the QR code."""

import hmac
import io
import json
import re
import secrets
import shutil
import socket
import ssl
import subprocess
import threading
import time
import wave
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import segno

from settings import HERE

PAGE = HERE / "phone"
# Path -> (file in PAGE, content type, needs the token)
FILES = {
    "/": ("index.html", "text/html; charset=utf-8", True),
    "/phone.js": ("phone.js", "text/javascript; charset=utf-8", False),
    "/phone.css": ("phone.css", "text/css; charset=utf-8", False),
}
HEADERS = {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
}
TUNNEL_URL = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")


def wav_seconds(data: bytes) -> float:
    """Duration of a WAV file; raises wave.Error or EOFError if the bytes are not one."""
    with wave.open(io.BytesIO(data)) as wav:
        return wav.getnframes() / wav.getframerate()


def make_handler(token: str, max_bytes: int, answer):
    """`answer(wav, upload_ms, respond)` runs one turn and calls `respond(reply)` once the reply
    text exists, before the rover speaks it. One turn runs at a time."""
    busy = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            # The default log line includes the query string, which holds the token.
            print(
                f"{self.command} {urlsplit(self.path).path} {args[1] if len(args) > 1 else ''}"
            )

        def _send(self, status, body: bytes, kind: str):
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            for name, value in HEADERS.items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status, payload: dict):
            self._send(
                status, json.dumps(payload).encode(), "application/json; charset=utf-8"
            )

        def _authorized(self) -> bool:
            given = parse_qs(urlsplit(self.path).query).get("t", [""])[0]
            return hmac.compare_digest(given.encode(), token.encode())

        def do_GET(self):
            entry = FILES.get(urlsplit(self.path).path)
            if entry is None:
                self._json(HTTPStatus.NOT_FOUND, {"error": "Not found."})
                return
            name, kind, needs_token = entry
            if needs_token and not self._authorized():
                self._json(HTTPStatus.FORBIDDEN, {"error": "This link has expired."})
                return
            self._send(HTTPStatus.OK, (PAGE / name).read_bytes(), kind)

        def do_POST(self):
            if urlsplit(self.path).path != "/api/ask":
                self._json(HTTPStatus.NOT_FOUND, {"error": "Not found."})
                return
            if not self._authorized():
                self._json(HTTPStatus.FORBIDDEN, {"error": "This link has expired."})
                return
            try:
                length = int(self.headers.get("Content-Length", ""))
            except ValueError:
                self._json(
                    HTTPStatus.LENGTH_REQUIRED, {"error": "No recording arrived."}
                )
                return
            if length > max_bytes:
                self._json(
                    HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                    {"error": "The question is too long. Please ask a shorter one."},
                )
                return
            start = time.perf_counter()
            wav = self.rfile.read(length)
            upload_ms = round((time.perf_counter() - start) * 1000)
            try:
                wav_seconds(wav)
            except (wave.Error, EOFError):
                self._json(
                    HTTPStatus.BAD_REQUEST,
                    {"error": "The recording was not a WAV file."},
                )
                return
            if not busy.acquire(blocking=False):
                self._json(
                    HTTPStatus.CONFLICT,
                    {"error": "Beaver is still answering the last question."},
                )
                return
            responded = False

            def respond(reply: str):
                nonlocal responded
                self._json(HTTPStatus.OK, {"reply": reply})
                responded = True

            try:
                answer(wav, upload_ms, respond)
            # Any failure in a turn must reach the phone as an error reply, not end the server.
            except (SystemExit, Exception) as error:  # noqa: BLE001
                print(f"Turn failed: {error}")
                if not responded:
                    self._json(
                        HTTPStatus.BAD_GATEWAY,
                        {"error": "Beaver could not answer. Please try again."},
                    )
            finally:
                busy.release()

    return Handler


def open_tunnel(settings: dict, port: int) -> tuple[subprocess.Popen, str]:
    """Start a Cloudflare quick tunnel to the local port; return the process and its address.

    Waits for the first registered connection, because the address answers with error 1033
    until then."""
    binary = shutil.which(settings["cloudflared"]) or shutil.which(
        str(Path.home() / ".local/bin/cloudflared")
    )
    if binary is None:
        raise SystemExit("cloudflared is not installed; run setup-pi.sh (see README)")
    process = subprocess.Popen(
        [
            binary,
            "tunnel",
            "--no-autoupdate",
            # QUIC on UDP 7844 may be blocked on campus networks; HTTP/2 uses TCP 443.
            "--protocol",
            "http2",
            "--url",
            f"http://127.0.0.1:{port}",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )
    deadline = time.monotonic() + settings["tunnel_timeout_seconds"]
    url = None
    for line in process.stderr:
        if url is None and (match := TUNNEL_URL.search(line)):
            url = match.group(0)
        if url and "Registered tunnel connection" in line:
            break
        if time.monotonic() > deadline:
            process.terminate()
            raise SystemExit("cloudflared did not connect in time")
    else:
        raise SystemExit("cloudflared exited before the tunnel connected")
    # Keep reading cloudflared's log so its pipe never fills and blocks it.
    threading.Thread(target=lambda: [None for _ in process.stderr], daemon=True).start()
    return process, url


def lan_address() -> str:
    """The Pi's address on the network that holds its default route. UDP connect sends nothing."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        probe.connect(("1.1.1.1", 53))
        return probe.getsockname()[0]


def serve(config: dict, answer) -> None:
    settings = config["phone"]
    token = secrets.token_urlsafe(16)
    handler = make_handler(token, settings["max_upload_bytes"], answer)
    port = settings["port"]
    tunnel = None
    if settings["tunnel"] == "cloudflare":
        server = ThreadingHTTPServer(("127.0.0.1", port), handler)
        tunnel, base = open_tunnel(settings, port)
    elif settings["tunnel"] == "none":
        if not (settings["certfile"] and settings["keyfile"]):
            raise SystemExit(
                "phone.tunnel = none needs phone.certfile and phone.keyfile: phone browsers "
                "only open the microphone over HTTPS (see README, phone hotspot)"
            )
        server = ThreadingHTTPServer(("0.0.0.0", port), handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(HERE / settings["certfile"], HERE / settings["keyfile"])
        server.socket = context.wrap_socket(server.socket, server_side=True)
        base = f"https://{lan_address()}:{port}"
    else:
        raise SystemExit("phone.tunnel must be cloudflare or none")
    url = f"{base}/?t={token}"
    print("\nScan this code with the phone's camera, or open the address below.\n")
    segno.make(url, error="l").terminal(compact=True)
    print(f"\n{url}\n\nWaiting for questions (Ctrl-C stops).")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()
        if tunnel:
            tunnel.terminate()
