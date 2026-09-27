"""Turn text into PCM speech with ElevenLabs."""

import os
import time

from elevenlabs import ElevenLabs
from elevenlabs.core import ApiError

from beaver.core.record import RunRecord


def pcm_sample_rate(output_format: str) -> int:
    kind, _, rate = output_format.partition("_")
    if kind != "pcm":
        raise SystemExit(
            f"elevenlabs.output_format must be a pcm_* format, got {output_format!r}"
        )
    return int(rate)


def check_length(config: dict, text: str) -> None:
    """Refuse text over elevenlabs.max_characters before anything is logged or sent, so a record
    never shows a request that did not go out."""
    limit = config["elevenlabs"]["max_characters"]
    if len(text) > limit:
        raise SystemExit(
            f"Text is {len(text)} characters, over elevenlabs.max_characters ({limit}); "
            "nothing was sent to ElevenLabs"
        )


def synthesize(config: dict, record: RunRecord, text: str) -> tuple[bytes, int]:
    """Return (16-bit mono PCM bytes, sample rate)."""
    check_length(config, text)
    record.data["elevenlabs_characters"] = len(text)
    record.sent(
        "ElevenLabs",
        model=config["elevenlabs"]["model"],
        voice_id=config["elevenlabs"]["voice_id"],
        characters=len(text),
        text=text,
    )
    pcm, rate, first_ms, total_ms = convert(config, text)
    record.data["timings_ms"]["elevenlabs_first_audio"] = first_ms
    record.data["timings_ms"]["elevenlabs_total"] = total_ms
    return pcm, rate


def convert(
    config: dict, text: str, language_code: str | None = None
) -> tuple[bytes, int, int, int]:
    """Synthesize one piece of text; return (PCM bytes, sample rate, first-audio ms, total ms).
    Safe to call from several threads at once. The language code is sent only when
    elevenlabs.send_language_code is on, since only some models accept it."""
    settings = config["elevenlabs"]
    rate = pcm_sample_rate(settings["output_format"])
    check_length(config, text)
    extra = {}
    if language_code and settings.get("send_language_code"):
        extra["language_code"] = language_code
    client = ElevenLabs(api_key=os.environ["ELEVENLABS_API_KEY"])
    start = time.perf_counter()
    chunks, first_ms = [], None
    try:
        for chunk in client.text_to_speech.convert(
            settings["voice_id"],
            text=text,
            model_id=settings["model"],
            output_format=settings["output_format"],
            **extra,
        ):
            if first_ms is None:
                first_ms = round((time.perf_counter() - start) * 1000)
            chunks.append(chunk)
    except ApiError as error:
        detail = (
            error.body.get("detail", error.body)
            if isinstance(error.body, dict)
            else error.body
        )
        if error.status_code == 401:
            raise SystemExit(
                f"ElevenLabs rejected the API key or quota was exceeded: {detail}"
            )
        if error.status_code == 429:
            raise SystemExit(f"ElevenLabs rate limit reached: {detail}")
        raise SystemExit(
            f"ElevenLabs rejected the request ({error.status_code}): {detail}"
        )
    total_ms = round((time.perf_counter() - start) * 1000)
    return b"".join(chunks), rate, first_ms or total_ms, total_ms
