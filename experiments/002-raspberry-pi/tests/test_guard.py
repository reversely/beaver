"""Guard rules: python -m unittest discover -s experiments/002-raspberry-pi/tests"""

import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from guard import check, luhn, redact, shorten


def rules(text):
    return [f.rule for f in check(text)]


class Personal(unittest.TestCase):
    def test_email(self):
        self.assertEqual(
            rules("write to marie.tremblay+tour@example.ca today"), ["email"]
        )

    def test_phone_formats(self):
        for text in [
            "613-555-0142",
            "(613) 555-0142",
            "613.555.0142",
            "613 555 0142",
            "+1 613 555 0142",
            "+44 20 7946 0958",
        ]:
            self.assertEqual(rules(f"call {text} please"), ["phone"], text)

    def test_postal_code(self):
        self.assertEqual(rules("I live near K1A 0A9 downtown"), ["postal_code"])
        self.assertEqual(rules("the code is k1a0a9"), ["postal_code"])

    def test_address(self):
        self.assertEqual(rules("meet me at 221 Rideau Street tomorrow"), ["address"])
        self.assertEqual(rules("j'habite au 1234 rue Sainte-Catherine"), ["address"])

    def test_social_insurance_needs_luhn(self):
        self.assertEqual(rules("my SIN is 130 692 544"), ["social_insurance"])
        # The published sample 046 454 286 starts with 0, which real numbers never do.
        self.assertEqual(rules("sample 046 454 286"), [])
        self.assertEqual(rules("the code 123 456 788 is wrong"), [])

    def test_payment_card_needs_luhn(self):
        self.assertEqual(rules("card 4111 1111 1111 1111 expires"), ["payment_card"])
        self.assertEqual(rules("card 4111 1111 1111 1112 expires"), [])

    def test_health_cards(self):
        self.assertEqual(rules("RAMQ TREM 1234 5678"), ["health_card_qc"])
        # 1234 567 897 passes Luhn; 1234 567 890 does not.
        self.assertTrue(luhn("1234567897"))
        self.assertEqual(rules("Ontario 1234-567-897-AB"), ["health_card_on"])
        self.assertEqual(rules("Ontario 1234-567-890"), [])


class History(unittest.TestCase):
    def test_years_and_dates_pass(self):
        text = (
            "Confederation came in 1867, the Group of Seven showed in 1920, and the Charter "
            "arrived on April 17, 1982. Key years: 1867 1921 1982 2024. The Peace Tower is 92.2 metres tall."
        )
        self.assertEqual(check(text), [])
        self.assertEqual(redact(text)[0], text)


class Redact(unittest.TestCase):
    def test_spoken_placeholders_and_no_original_in_findings(self):
        text, findings = redact("Call 613-555-0142 or email a@b.ca about K1A 0A9.")
        self.assertEqual(
            text, "Call a phone number or email an email address about a postal code."
        )
        self.assertEqual([f.rule for f in findings], ["phone", "email", "postal_code"])
        self.assertFalse(any("613" in repr(f) for f in findings))

    def test_speed(self):
        reply = ("Poutine is a classic Quebec dish from the 1950s. " * 12)[
            :600
        ] + " Call 613-555-0142."
        start = time.perf_counter()
        for _ in range(100):
            redact(reply)
        self.assertLess((time.perf_counter() - start) / 100, 0.005)


class Shorten(unittest.TestCase):
    def test_fits(self):
        self.assertEqual(shorten("Short.", 20), ("Short.", 0.0))

    def test_sentence_boundary(self):
        text = "First sentence here. Second sentence is longer than the limit allows."
        cut, dropped = shorten(text, 30)
        self.assertEqual(cut, "First sentence here.")
        self.assertGreater(dropped, 0.5)

    def test_no_sentence_end_cuts_at_word(self):
        cut, _ = shorten("one two three four five six seven", 15)
        self.assertEqual(cut, "one two three.")

    def test_full_width_stop(self):
        cut, _ = shorten("Poutine是經典美食！它包含三個主要元素。", 13)
        self.assertEqual(cut, "Poutine是經典美食！")


if __name__ == "__main__":
    unittest.main()
