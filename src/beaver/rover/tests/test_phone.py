"""Phone server answers: python -m unittest discover -s src/beaver/rover/tests"""

import io
import json
import re
import sys
import threading
import unittest
import urllib.error
import urllib.request
import wave
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from phone import PAGE, make_handler
from transcribe import AUTO, LANGUAGES, pick_language

TOKEN = "test-token"


def wav_bytes(seconds: float = 0.5) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"\0\0" * int(16000 * seconds))
    return buffer.getvalue()


class PhoneServer(unittest.TestCase):
    def setUp(self):
        self.turns = []

        def answer(wav, upload_ms, respond, language):
            self.turns.append(language)
            respond(f"reply in {language}")

        handler = make_handler(TOKEN, 64 * 1024, answer)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def post(self, query: str, body: bytes):
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/api/ask?{query}",
            data=body,
            method="POST",
            headers={"Content-Type": "audio/wav"},
        )
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def test_language_reaches_the_turn(self):
        status, body = self.post(f"t={TOKEN}&lang=zh", wav_bytes())
        self.assertEqual((status, body["reply"]), (200, "reply in zh"))
        self.assertEqual(self.turns, ["zh"])

    def test_automatic_detection_reaches_the_turn(self):
        status, body = self.post(f"t={TOKEN}&lang={AUTO}", wav_bytes())
        self.assertEqual((status, body["reply"]), (200, f"reply in {AUTO}"))
        self.assertEqual(self.turns, [AUTO])

    def test_unknown_or_missing_language_is_refused(self):
        for query in (
            f"t={TOKEN}&lang=xx",
            f"t={TOKEN}",
            f"t={TOKEN}&lang=en%00",
            f"t={TOKEN}&lang=AUTO",
        ):
            self.assertEqual(self.post(query, wav_bytes())[0], 400, query)
        self.assertEqual(self.turns, [])

    def test_existing_answers_hold(self):
        self.assertEqual(self.post("t=wrong&lang=en", wav_bytes())[0], 403)
        self.assertEqual(self.post(f"t={TOKEN}&lang=en", b"not a wav file")[0], 400)
        self.assertEqual(self.post(f"t={TOKEN}&lang=en", wav_bytes(3.0))[0], 413)
        self.assertEqual(self.turns, [])


class PageLanguages(unittest.TestCase):
    def test_page_offers_exactly_the_server_list(self):
        html = (PAGE / "index.html").read_text()
        offered = re.findall(r'<option value="([a-z]+)"', html)
        self.assertEqual(offered, [AUTO, *LANGUAGES])


class PickLanguage(unittest.TestCase):
    def test_most_likely_supported_language_wins(self):
        probabilities = [("pt", 0.6), ("es", 0.3), ("en", 0.05)]
        self.assertEqual(pick_language(probabilities, 0.2), ("es", 0.3))

    def test_below_the_threshold_means_ask(self):
        self.assertEqual(pick_language([("fr", 0.55), ("en", 0.4)], 0.7), (None, 0.55))

    def test_threshold_is_inclusive(self):
        self.assertEqual(pick_language([("zh", 0.7)], 0.7), ("zh", 0.7))

    def test_no_supported_language_means_ask(self):
        self.assertEqual(pick_language([("pt", 0.9), ("de", 0.1)], 0.7), (None, 0.0))
        self.assertEqual(pick_language([], 0.7), (None, 0.0))


if __name__ == "__main__":
    unittest.main()
