"""Answer, translate, and speak through the beaver-agent Worker (agent/) with Workers AI (#60).

The laptop still transcribes each question with Whisper and runs the guard on the question and on
every answer sentence; this module only carries guarded text and camera frames to the agent. The
Worker refuses any request without the shared token in BEAVER_AGENT_TOKEN.
"""

import base64
import json
import os
import time
import urllib.error
import urllib.request

from beaver.core.record import RunRecord


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


def convert(config: dict, text: str, code: str) -> tuple[bytes, None, int, int]:
    """One sentence as MP3 from Workers AI MeloTTS. The rate is None because the audio is MP3,
    which the page plays as is; speech.convert returns PCM with its rate."""
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
