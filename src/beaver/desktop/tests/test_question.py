"""The desktop app's questions and answers through the guard (#45):
uv run --group desktop python -m unittest discover -s src/beaver/desktop/tests"""

import base64
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from beaver.core.settings import load_config
from server import _question, guard_answer

CONFIG = load_config(Path(__file__).parents[1] / "config.toml", [])


class Record:
    """Stands in for RunRecord: keeps data in memory and writes no run folder."""

    def __init__(self):
        self.data = {"timings_ms": {}}
        self.saved = {}

    def save_file(self, name, data):
        self.saved[name] = data
        return Path(name)

    def timed(self, label):
        import contextlib

        return contextlib.nullcontext()


def spoken(text, language="en", probability=0.95):
    """A transcriber that hears `text`, so tests need no Whisper model."""
    return lambda config, wav: (language, text, probability)


class QuestionTest(unittest.TestCase):
    def test_typed_question_is_redacted_before_gemini(self):
        record = Record()
        parts = _question(
            CONFIG, record, {"text": "my phone number is 613 555 0142"}, None
        )
        self.assertEqual(len(parts), 1)
        self.assertIsInstance(parts[0], str)
        self.assertIn("my phone number is a phone number", parts[0])
        self.assertNotIn("0142", parts[0])
        self.assertEqual(record.data["question"], "my phone number is a phone number")
        self.assertEqual(record.data["guard_question"], ["phone"])

    def test_spoken_question_sends_text_and_no_audio(self):
        record = Record()
        wav = base64.b64encode(b"RIFF fake audio").decode()
        parts = _question(
            CONFIG,
            record,
            {"audio_wav": wav},
            spoken("my phone number is 613 555 0142"),
        )
        self.assertTrue(all(isinstance(part, str) for part in parts))
        self.assertIn("my phone number is a phone number", parts[0])
        self.assertNotIn("0142", " ".join(parts))
        # The audio stays in this laptop's run folder.
        self.assertIn("question.wav", record.saved)

    def test_unsure_language_asks_again(self):
        with self.assertRaises(ValueError):
            _question(CONFIG, Record(), {"audio_wav": ""}, spoken("", None, 0.4))

    def test_answer_is_redacted_and_keeps_the_guarded_question(self):
        record = Record()
        record.data["question"] = "call me at a phone number"
        result = {
            "question": "call me at 613 555 0142",
            "visitor": {"code": "en"},
            "codes": ["en"],
            "groups": [[("en", "Your number 613 555 0142 is saved.")]],
        }
        guarded = guard_answer(result, record)
        self.assertEqual(guarded["question"], "call me at a phone number")
        self.assertNotIn("0142", guarded["groups"][0][0][1])


if __name__ == "__main__":
    unittest.main()
