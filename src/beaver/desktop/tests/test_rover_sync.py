"""Rover turn filing: python -m unittest discover -s src/beaver/desktop/tests"""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parents[1]))

import rover_sync
from beaver.core.settings import load_config

CONFIG = load_config(Path(__file__).parents[1] / "config.toml", [])
PROMPT_VARS = {"prompt_vars": {"answer_language": "English"}}


class Filing(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        patch = mock.patch.object(rover_sync, "_local_dir", return_value=self.dir)
        patch.start()
        self.addCleanup(patch.stop)
        self.addCleanup(self.tmp.cleanup)

    def turn(self, name, record, audio=False):
        folder = self.dir / name
        folder.mkdir()
        (folder / "record.json").write_text(
            json.dumps({**record, "config": PROMPT_VARS})
        )
        if audio:
            (folder / "question.wav").write_bytes(b"RIFF")
        return folder

    def file_pending(self, transcribed=None):
        filed, asks = [], []

        def ask(config, record, system, prompt, parts=(), **kwargs):
            asks.append(kwargs.get("label"))
            return json.dumps(transcribed)

        def file_exchange(config, record, result):
            filed.append(result)
            return {"id": "nb"}

        with (
            mock.patch.object(rover_sync.gemini, "ask", ask),
            mock.patch.object(rover_sync.notebooks, "file_exchange", file_exchange),
            mock.patch.object(rover_sync, "RunRecord") as run_record,
        ):
            run_record.return_value.dir.name = "desktop-run"
            for folder, rover in rover_sync._pending(CONFIG):
                rover_sync._file_turn(CONFIG, folder, rover)
        return filed, asks

    def test_redacted_question_files_without_transcription(self):
        self.turn(
            "a-phone",
            {
                "question_language": "auto",
                "detected_language": {"language": "fr", "probability": 1.0},
                "question": "Pourquoi le Canada a-t-il deux langues officielles ?",
                "reply": "Because...",
            },
        )
        filed, asks = self.file_pending()
        self.assertEqual(asks, [])
        self.assertEqual(filed[0]["visitor"], {"name": "French", "code": "fr"})
        self.assertEqual(filed[0]["question"][:8], "Pourquoi")

    def test_chosen_language_is_used(self):
        self.turn(
            "a-phone",
            {"question_language": "zh", "question": "那是什么？", "reply": "..."},
        )
        filed, _ = self.file_pending()
        self.assertEqual(filed[0]["visitor"], {"name": "Chinese", "code": "zh"})

    def test_ask_again_turns_are_not_filed(self):
        self.turn(
            "a-phone",
            {
                "question_language": "auto",
                "detected_language": {"language": None, "probability": 0.4},
                "reply": "I could not tell which language you spoke.",
            },
        )
        self.turn(
            "b-phone",
            {
                "question_language": "en",
                "question": "",
                "reply": "I did not catch that.",
            },
        )
        self.assertEqual(self.file_pending(), ([], []))

    def test_legacy_turn_is_transcribed_from_audio_once(self):
        self.turn("a-look", {"reply": "An old answer."}, audio=True)
        heard = {
            "question": "What is this?",
            "language_name": "English",
            "language_code": "en",
        }
        filed, asks = self.file_pending(heard)
        self.assertEqual(asks, ["gemini_rover_question"])
        self.assertEqual(filed[0]["question"], "What is this?")
        self.assertEqual(self.file_pending(heard), ([], []))

    def test_unreadable_record_is_skipped(self):
        (self.dir / "a-speak").mkdir()
        (self.dir / "a-speak" / "record.json").write_text("")
        self.assertEqual(rover_sync._pending(CONFIG), [])


if __name__ == "__main__":
    unittest.main()
