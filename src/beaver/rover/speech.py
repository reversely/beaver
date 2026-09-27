"""Turn text into PCM speech with ElevenLabs."""

import os
import time

from elevenlabs import ElevenLabs
from elevenlabs.core import ApiError

from record import RunRecord


def pcm_sample_rate(output_format: str) -> int:
    kind, _, rate = output_format.partition("_")
    if kind != "pcm":
        raise SystemExit(
            f"elevenlabs.output_format must be a pcm_* format, got {output_format!r}"
        )
    return int(rate)


def synthesize(config: dict, record: RunRecord, text: str) -> tuple[bytes, int]:
    """Return (16-bit mono PCM bytes, sample rate)."""
    settings = config["elevenlabs"]
    rate = pcm_sample_rate(settings["output_format"])
    if len(text) > settings["max_characters"]:
        raise SystemExit(
            f"Reply is {len(text)} characters, over elevenlabs.max_characters "
            f"({settings['max_characters']}); nothing was sent to ElevenLabs"
        )
    record.data["elevenlabs_characters"] = len(text)
    record.sent(
        "ElevenLabs",
        model=settings["model"],
        voice_id=settings["voice_id"],
        characters=len(text),
        text=text,
    )
    client = ElevenLabs(api_key=os.environ["ELEVENLABS_API_KEY"])
    start = time.perf_counter()
    chunks = []
    try:
        for chunk in client.text_to_speech.convert(
            settings["voice_id"],
            text=text,
            model_id=settings["model"],
            output_format=settings["output_format"],
        ):
            if not chunks:
                record.mark("elevenlabs_first_audio", start)
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
    record.mark("elevenlabs_total", start)
    return b"".join(chunks), rate
