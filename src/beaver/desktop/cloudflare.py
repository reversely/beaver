"""Answer, translate, and speak through the beaver-agent Worker (agent/) with Workers AI (#60).

The laptop still transcribes each question with Whisper and runs the guard on the question and on
every answer sentence; this module only carries guarded text and camera frames to the agent. The
Worker refuses any request without the shared token in BEAVER_AGENT_TOKEN.
"""

import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

from beaver.core.record import RunRecord

# Cloudflare's edge refuses the default Python-urllib user agent (error 1010) before the Worker
# runs, so every request names this app.
USER_AGENT = "beaver-desktop/1"


def viewer_key(token: str, session: str) -> str:
    """The key in a viewer link: HMAC-SHA256 of the session name under the shared token, as 32 hex
    characters. The Worker derives the same key (agent/src/auth.ts) and opens a read-only
    connection to that session only."""
    return hmac.new(token.encode(), session.encode(), hashlib.sha256).hexdigest()[:32]


def viewer_link(config: dict) -> str | None:
    """The live session page for other screens (#61), or None without a token."""
    token = os.environ.get("BEAVER_AGENT_TOKEN")
    if not token:
        return None
    settings = config["cloudflare"]
    query = urllib.parse.urlencode(
        {"s": settings["session"], "key": viewer_key(token, settings["session"])}
    )
    return f"{settings['url'].rstrip('/')}/session.html?{query}"


def publish(config: dict, result: dict, filing: dict | None = None) -> None:
    """Send one guarded turn to the session's agent, which shows it on every viewer (#61) and,
    given `filing` (notebooks.filing_request), files it into a notebook (#62). Call only with the
    result of server.guard_answer, so the agent holds checked text alone."""
    sentences = [
        {"group": g, "code": code, "text": text}
        for g, group in enumerate(result["groups"])
        for code, text in group
    ]
    visitor = {"name": result["visitor"]["name"], "code": result["visitor"]["code"]}
    _post(
        config,
        "publish",
        {
            "question": result["question"],
            "visitor": visitor,
            "sentences": sentences,
            **({"notebook": filing} if filing else {}),
        },
    )


def review(config: dict, word_id: int, remembered: bool) -> dict:
    """Mark a due word remembered or forgotten; the agent schedules its next review (#63)."""
    body, _ = _post(config, "review", {"id": word_id, "remembered": remembered})
    return json.loads(body)


def socket_url(link: str) -> str:
    """The viewer WebSocket for a viewer link, so this app's page can follow the session's state."""
    parts = urllib.parse.urlsplit(link)
    query = urllib.parse.parse_qs(parts.query)
    scheme = "wss" if parts.scheme == "https" else "ws"
    path = f"/agents/beaver-guide/{urllib.parse.quote(query['s'][0], safe='')}"
    return urllib.parse.urlunsplit(
        (
            scheme,
            parts.netloc,
            path,
            urllib.parse.urlencode({"key": query["key"][0]}),
            "",
        )
    )


def notebooks(config: dict, notebook_id: str | None = None) -> tuple[int, bytes]:
    """The session's notebooks from the agent (#62): the summaries, or one notebook by id, as
    (HTTP status, JSON body)."""
    token = os.environ.get("BEAVER_AGENT_TOKEN")
    if not token:
        raise SystemExit(
            "Set BEAVER_AGENT_TOKEN in .env to use the Cloudflare provider"
        )
    path = "notebooks" + (
        f"/{urllib.parse.quote(notebook_id, safe='')}" if notebook_id else ""
    )
    request = urllib.request.Request(
        _url(config, path),
        headers={"Authorization": f"Bearer {token}", "User-Agent": USER_AGENT},
    )
    try:
        with urllib.request.urlopen(
            request, timeout=config["cloudflare"]["timeout_seconds"]
        ) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()
    except urllib.error.URLError as error:
        raise SystemExit(f"Cloudflare agent could not be reached: {error.reason}")


def _url(config: dict, action: str) -> str:
    settings = config["cloudflare"]
    return f"{settings['url'].rstrip('/')}/agents/beaver-guide/{settings['session']}/{action}"


def _post(config: dict, action: str, payload: dict) -> tuple[bytes, dict]:
    """POST JSON to one agent action; return the body and response headers."""
    token = os.environ.get("BEAVER_AGENT_TOKEN")
    if not token:
        raise SystemExit(
            "Set BEAVER_AGENT_TOKEN in .env to use the Cloudflare provider"
        )
    request = urllib.request.Request(
        _url(config, action),
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(
            request, timeout=config["cloudflare"]["timeout_seconds"]
        ) as response:
            return response.read(), dict(response.headers)
    except urllib.error.HTTPError as error:
        try:
            detail = json.loads(error.read()).get("error", error.reason)
        except ValueError:
            detail = error.reason
        raise SystemExit(f"Cloudflare agent {action} failed ({error.code}): {detail}")
    except urllib.error.URLError as error:
        raise SystemExit(f"Cloudflare agent could not be reached: {error.reason}")


def _part(attachment) -> dict:
    if isinstance(attachment, str):
        return {"text": attachment}
    data, mime, _ = attachment
    if mime != "image/jpeg":
        raise SystemExit(f"The Cloudflare provider takes JPEG images only, not {mime}")
    return {"image_jpeg": base64.b64encode(data).decode()}


def ask(
    config: dict,
    record: RunRecord,
    system: str,
    text: str,
    attachments: list = (),
    schema: dict | None = None,
    label: str = "gemini",
) -> str:
    """The same contract as gemini.ask, answered by the agent's Workers AI model."""
    label = label.replace("gemini", "workers_ai")
    record.sent(
        "Workers AI",
        session=config["cloudflare"]["session"],
        system_prompt=system,
        attachments=[a if isinstance(a, str) else a[2] for a in attachments] or "none",
        user_prompt=text,
    )
    start = time.perf_counter()
    body, _ = _post(
        config,
        "ask",
        {
            "system": system,
            "instruction": text,
            "parts": [_part(a) for a in attachments],
            "schema": schema,
            "temperature": config["gemini"]["temperature"],
            "max_tokens": config["gemini"]["max_output_tokens"],
        },
    )
    record.mark(label, start)
    reply = json.loads(body)
    record.data["timings_ms"][f"{label}_model"] = reply["ms"]
    record.data[f"{label}_tokens"] = {
        "prompt": reply["usage"]["prompt"],
        "prompt_by_type": {},
        "reply": reply["usage"]["reply"],
        "thinking": 0,
        "model": reply["model"],
    }
    return reply["text"]


def translate(
    config: dict,
    record: RunRecord,
    sentences: list[str],
    source: str,
    targets: list[str],
) -> dict[str, list[str]]:
    """Every sentence in every target language, from Workers AI m2m100 in one agent request."""
    if not targets:
        return {}
    record.sent(
        "Workers AI m2m100", targets=", ".join(targets), sentences="\n".join(sentences)
    )
    with record.timed("workers_ai_translate"):
        body, _ = _post(
            config,
            "translate",
            {"sentences": sentences, "source": source, "targets": targets},
        )
    return json.loads(body)["translations"]


def audio_extension(audio: bytes) -> str:
    """The file extension for encoded speech, from its first bytes. MeloTTS has returned WAV
    where its schema says MP3."""
    if audio[:4] == b"RIFF":
        return ".wav"
    if audio[:4] == b"OggS":
        return ".ogg"
    return ".mp3"


def convert(config: dict, text: str, code: str) -> tuple[bytes, None, int, int]:
    """One sentence as an encoded audio file from Workers AI MeloTTS. The rate is None because
    the file carries its own format, which the page plays as is; speech.convert returns raw PCM
    with its rate."""
    limit = config["cloudflare"]["max_characters"]
    if len(text) > limit:
        raise SystemExit(
            f"Text is {len(text)} characters, over cloudflare.max_characters ({limit})"
        )
    start = time.perf_counter()
    audio, _ = _post(config, "speak", {"text": text, "lang": code})
    total_ms = round((time.perf_counter() - start) * 1000)
    # MeloTTS returns the whole clip at once, so first audio and total are the same.
    return audio, None, total_ms, total_ms
