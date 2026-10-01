"""Answers keep no sentence that only reports the visitor's language (#68):
python -m unittest discover -s src/beaver/desktop/tests"""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from bilingual import drop_language_reports, names_visitor_language

CASES = json.loads((Path(__file__).parent / "language_report_cases.json").read_text())


class LanguageReports(unittest.TestCase):
    def test_shared_cases(self):
        # agent/test/turn.test.ts checks the agent's port against the same file.
        for case in CASES:
            self.assertEqual(
                names_visitor_language(case["sentence"], case["name"], case["code"]),
                case["drop"],
                case["sentence"],
            )

    def test_only_the_report_is_dropped(self):
        sentences = ["The visitor spoke Spanish, es.", "Ottawa is the capital."]
        visitor = {"name": "Spanish", "code": "es"}
        self.assertEqual(
            drop_language_reports(sentences, visitor), ["Ottawa is the capital."]
        )


if __name__ == "__main__":
    unittest.main()
