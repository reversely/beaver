"""Send a system prompt plus text, audio, or image parts to Gemini and return the reply."""

import os
import time

from google import genai
from google.genai import errors, types

from beaver.core.record import RunRecord


def _part(attachment):
    if isinstance(attachment, str):
        return types.Part.from_text(text=attachment)
    data, mime, _ = attachment
    return types.Part.from_bytes(data=data, mime_type=mime)


def _describe(attachment):
    return attachment if isinstance(attachment, str) else attachment[2]


def _generate(client, settings, parts, request_config, record, label):
    """Retry server errors such as 503 "high demand"; the timing covers the final attempt only."""
    for attempt in range(settings["retries"] + 1):
        try:
            with record.timed(label):
                response = client.models.generate_content(
                    model=settings["model"], contents=parts, config=request_config
                )
            record.data[f"{label}_retries"] = attempt
            return response
        except errors.ServerError as error:
            if attempt == settings["retries"]:
                raise
            print(
                f"Gemini server error ({error.code}); retrying in "
                f"{settings['retry_wait_seconds']} s"
            )
            time.sleep(settings["retry_wait_seconds"])


def ask(
    config: dict,
    record: RunRecord,
    system: str,
    text: str,
    attachments: list = (),
    schema: dict | None = None,
    label: str = "gemini",
) -> str:
    """Each attachment is a text string or a (bytes, mime_type, description) tuple; the
    description is what gets logged. Attachments precede the instruction `text`. A JSON
    `schema` makes Gemini reply with matching JSON. `label` names the timing and token entries."""
    settings = config["gemini"]
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    parts = [_part(attachment) for attachment in attachments]
    parts.append(types.Part.from_text(text=text))
    thinking = (
        types.ThinkingConfig(thinking_level=settings["thinking_level"].upper())
        if settings["thinking_level"]
        else None
    )
    resolution = (
        types.MediaResolution[
            f"MEDIA_RESOLUTION_{settings['media_resolution'].upper()}"
        ]
        if settings["media_resolution"]
        else None
    )
    request_config = types.GenerateContentConfig(
        system_instruction=system,
        temperature=settings["temperature"],
        max_output_tokens=settings["max_output_tokens"],
        thinking_config=thinking,
        media_resolution=resolution,
        response_mime_type="application/json" if schema else None,
        response_json_schema=schema,
        # Beaver declares no tools, so the SDK's automatic tool calling stays off.
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )
    record.sent(
        "Gemini",
        model=settings["model"],
        media_resolution=settings["media_resolution"] or "model default",
        system_prompt=system,
        attachments=[_describe(a) for a in attachments] or "none",
        user_prompt=text,
    )
    try:
        response = _generate(client, settings, parts, request_config, record, label)
    except errors.ServerError as error:
        raise SystemExit(
            f"Gemini server error ({error.code}) after {settings['retries']} retries: "
            f"{error.message}"
        )
    except errors.ClientError as error:
        if error.code == 402:
            raise SystemExit(
                "Gemini prepaid credits are used up; add credit to the AI Studio project "
                f"(https://ai.studio/projects): {error.message}"
            )
        if error.code == 429:
            raise SystemExit(
                f"Gemini rate limit reached (free tier quota): {error.message}"
            )
        raise SystemExit(f"Gemini rejected the request ({error.code}): {error.message}")
    usage = response.usage_metadata
    record.data[f"{label}_tokens"] = {
        "prompt": usage.prompt_token_count,
        "prompt_by_type": {
            detail.modality.name.lower(): detail.token_count
            for detail in usage.prompt_tokens_details or []
        },
        "reply": usage.candidates_token_count,
        "thinking": usage.thoughts_token_count or 0,
    }
    reply = (response.text or "").strip()
    if not reply:
        raise SystemExit(
            f"Gemini returned no text (finish reason: {response.candidates[0].finish_reason})"
        )
    return reply
