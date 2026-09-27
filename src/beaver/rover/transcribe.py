"""Turn a spoken question into text on the Pi, in the language the phone page chose or detected.

Transcribing on board lets the guard redact personal information before any of the question
reaches Gemini. Whisper base with the language given took 1.8 s for an English question and 5.6 s
for a Chinese one on the Pi 5 at two threads (docs/measurements.md).
"""

import io

from beaver.core.languages import LANGUAGES

# The phone page's choice that asks the rover to detect the language itself.
AUTO = "auto"


def pick_language(
    probabilities: list[tuple[str, float]], min_probability: float
) -> tuple[str | None, float]:
    """The most likely of LANGUAGES and its probability, or (None, p) when it scores under
    min_probability. Whisper scores about 100 languages; a question it hears as, say, Portuguese
    has no page language to answer in, so only the page's languages compete."""
    supported = [(code, p) for code, p in probabilities if code in LANGUAGES]
    if not supported:
        return None, 0.0
    code, probability = max(supported, key=lambda pair: pair[1])
    return (code if probability >= min_probability else None), probability


class Transcriber:
    """Loads the Whisper model once; each call transcribes one WAV question."""

    def __init__(self, config: dict):
        # Imported here so commands that never transcribe do not load CTranslate2.
        from faster_whisper import WhisperModel

        settings = config["transcribe"]
        self.min_probability = settings["detect_min_probability"]

        self.model = WhisperModel(
            settings["model"],
            device="cpu",
            compute_type=settings["compute_type"],
            cpu_threads=settings["cpu_threads"],
        )

    def detect_and_transcribe(self, wav: bytes) -> tuple[str | None, str, float]:
        """(language, text, probability) in one base pass, or (None, "", p) when Whisper is not
        confident enough, in which case no segment is decoded. On the rover's real recordings,
        tiny heard a Chinese question as English with 0.79, while base gave English only 0.40
        and so asks instead (docs/measurements.md)."""
        segments, info = self.model.transcribe(
            io.BytesIO(wav), language=None, beam_size=1, vad_filter=True
        )
        language, probability = pick_language(
            info.all_language_probs or [], self.min_probability
        )
        if language is None:
            return None, "", probability
        if language != info.language:
            # Whisper's top guess was outside the page's languages; transcribe in the pick.
            return language, self(wav, language), probability
        return (
            language,
            " ".join(seg.text.strip() for seg in segments).strip(),
            probability,
        )

    def __call__(self, wav: bytes, language: str) -> str:
        if language not in LANGUAGES:
            raise ValueError(f"unsupported language {language!r}")
        segments, _ = self.model.transcribe(
            io.BytesIO(wav), language=language, beam_size=1, vad_filter=True
        )
        return " ".join(segment.text.strip() for segment in segments).strip()
