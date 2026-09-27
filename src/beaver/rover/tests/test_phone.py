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

from phone import MAX_LOCATION_BYTES, PAGE, LastLocation, make_handler, parse_location
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

        self.location = LastLocation()
        handler = make_handler(TOKEN, 64 * 1024, answer, self.location)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def post(self, query: str, body: bytes, path: str = "/api/ask"):
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{path}?{query}",
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

    def locate(self, query: str, body: bytes):
        return self.post(query, body, "/api/location")[0]

    def test_location_is_rounded_and_kept(self):
        body = json.dumps({"lat": 45.42456, "lon": -75.69972}).encode()
        self.assertEqual(self.locate(f"t={TOKEN}", body), 200)
        self.assertEqual(self.location.get(), {"lat": 45.42, "lon": -75.7})

    def test_location_needs_the_token(self):
        body = json.dumps({"lat": 45.42, "lon": -75.70}).encode()
        self.assertEqual(self.locate("t=wrong", body), 403)
        self.assertIsNone(self.location.get())

    def test_bad_locations_are_refused(self):
        bodies = [
            b"not json",
            b"[45.42, -75.70]",
            json.dumps({"lat": 91, "lon": 0}).encode(),
            json.dumps({"lat": 0, "lon": -181}).encode(),
            json.dumps({"lat": True, "lon": 0}).encode(),
            json.dumps({"lat": "45", "lon": "-75"}).encode(),
            json.dumps({"lat": 45, "lon": -75, "name": "home"}).encode(),
            b'{"lat": NaN, "lon": 0}',
            b'{"lat": Infinity, "lon": 0}',
        ]
        for body in bodies:
            self.assertEqual(self.locate(f"t={TOKEN}", body), 400, body)
        oversized = (
            json.dumps({"lat": 45.0, "lon": -75.0})
            .encode()
            .ljust(MAX_LOCATION_BYTES + 1)
        )
        self.assertEqual(self.locate(f"t={TOKEN}", oversized), 413)
        self.assertIsNone(self.location.get())


class ParseLocation(unittest.TestCase):
    def test_rounds_to_two_decimals(self):
        self.assertEqual(
            parse_location(b'{"lat": 43.65107, "lon": -79.347015}'), (43.65, -79.35)
        )


class NoLocationEndpoint(unittest.TestCase):
    def test_absent_without_a_holder(self):
        server = ThreadingHTTPServer(
            ("127.0.0.1", 0), make_handler(TOKEN, 1024, lambda *a: None)
        )
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_address[1]}/api/location?t={TOKEN}",
                data=b'{"lat": 1, "lon": 1}',
                method="POST",
            )
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(request)
            self.assertEqual(caught.exception.code, 404)
        finally:
            server.shutdown()
            server.server_close()


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
