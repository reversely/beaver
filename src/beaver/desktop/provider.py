"""The provider setting picks who answers, translates, and speaks: "gemini" (Gemini and
ElevenLabs) or "cloudflare" (Workers AI through the beaver-agent Worker, #60)."""

import cloudflare
from beaver.core import gemini, speech


def is_cloudflare(config: dict) -> bool:
    return config["provider"]["name"] == "cloudflare"


def ask(config: dict, *args, **kwargs) -> str:
    return (cloudflare.ask if is_cloudflare(config) else gemini.ask)(
        config, *args, **kwargs
    )


def voice(config: dict) -> tuple:
    """(convert function, languages it speaks) for synthesize_in_order."""
    if is_cloudflare(config):
        return cloudflare.convert, set(config["cloudflare"]["spoken_languages"])
    return speech.convert, set(config["elevenlabs"]["spoken_languages"])
