"""Turn a spoken question into text on the Pi, in the language the phone page chose.

Transcribing on board lets the guard redact personal information before any of the question
reaches Gemini. Whisper base with the language given took 1.8 s for an English question and 5.6 s
for a Chinese one on the Pi 5 at two threads (docs/measurements.md).
"""

import io

# The phone page's languages: code (as the page sends it and Whisper takes it) -> name in English.
LANGUAGES = {
    "en": "English",
    "fr": "French",
    "es": "Spanish",
    "ar": "Arabic",
    "zh": "Chinese",
    "pa": "Punjabi",
    "tl": "Tagalog",
    "uk": "Ukrainian",
}


class Transcriber:
    """Loads the Whisper model once; each call transcribes one WAV question."""

    def __init__(self, config: dict):
        # Imported here so commands that never transcribe do not load CTranslate2.
        from faster_whisper import WhisperModel

        settings = config["transcribe"]
        self.model = WhisperModel(
            settings["model"],
            device="cpu",
            compute_type=settings["compute_type"],
            cpu_threads=settings["cpu_threads"],
        )

    def __call__(self, wav: bytes, language: str) -> str:
        if language not in LANGUAGES:
            raise ValueError(f"unsupported language {language!r}")
        segments, _ = self.model.transcribe(
            io.BytesIO(wav), language=language, beam_size=1, vad_filter=True
        )
        return " ".join(segment.text.strip() for segment in segments).strip()
