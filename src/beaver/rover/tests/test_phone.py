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
from transcribe import LANGUAGES

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

    def test_unknown_or_missing_language_is_refused(self):
        for query in (f"t={TOKEN}&lang=xx", f"t={TOKEN}", f"t={TOKEN}&lang=en%00"):
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
        self.assertEqual(offered, list(LANGUAGES))


if __name__ == "__main__":
    unittest.main()
