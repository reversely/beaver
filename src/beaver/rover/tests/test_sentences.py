"""Sentence splitting and pairing: python -m unittest discover -s src/beaver/rover/tests"""

import unittest

from beaver.core.sentences import group, split_sentences


class FakeRecord:
    def __init__(self):
        self.data = {}


class Sentences(unittest.TestCase):
    def test_split_keeps_abbreviations_and_cjk(self):
        self.assertEqual(
            split_sentences("Walk to St. Laurent Blvd. Then turn. 好吃！很好。"),
            ["Walk to St. Laurent Blvd. Then turn.", "好吃！", "很好。"],
        )

    def test_groups_pair_sentences_in_display_order(self):
        codes, groups = group(
            FakeRecord(),
            ["es", "fr", "en"],
            {
                "en": ["Hi.", "Bye."],
                "es": ["Hola.", "Adiós."],
                "fr": ["Salut.", "Au revoir."],
            },
            2,
        )
        self.assertEqual(codes, ["es", "fr", "en"])
        self.assertEqual(
            groups[1], [("es", "Adiós."), ("fr", "Au revoir."), ("en", "Bye.")]
        )

    def test_a_translation_of_the_wrong_length_is_dropped_and_noted(self):
        record = FakeRecord()
        codes, groups = group(
            record,
            ["es", "fr", "en"],
            {"en": ["Hi."], "es": ["Hola.", "Extra."], "fr": ["Salut."]},
            1,
        )
        self.assertEqual(codes, ["fr", "en"])
        self.assertEqual(groups, [[("fr", "Salut."), ("en", "Hi.")]])
        self.assertEqual(record.data["translation_mismatch"], ["es"])


if __name__ == "__main__":
    unittest.main()
