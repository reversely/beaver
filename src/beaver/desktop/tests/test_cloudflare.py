"""The Cloudflare provider against a fake beaver-agent (#60): the token reaches the agent, and the
agent receives only guarded text, for the question and for every sentence it is asked to speak.
python -m unittest discover -s src/beaver/desktop/tests"""

import copy
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import ClassVar
from unittest import mock

sys.path.insert(0, str(Path(__file__).parents[1]))

import cloudflare
import server
from beaver.core.settings import load_config

CONFIG = load_config(Path(__file__).parents[1] / "config.toml", [])
TOKEN = "test-token"
# The fake model repeats a phone number in its answer, so the reply guard has work to do.
ANSWER = {
    "question": "ignored",
    "visitor_language_name": "English",
    "visitor_language_code": "en",
    "answer": "Poutine comes from Quebec. Call 613 555 0142 for a table.",
}


class FakeAgent(BaseHTTPRequestHandler):
    calls: ClassVar[list] = []

    def log_message(self, *args):
        pass

    def do_GET(self):
        FakeAgent.calls.append((self.path, self.headers["Authorization"], "get", None))
        if self.path.endswith("/notebooks"):
            self._send(b'[{"id": "ab12cd34", "entries": 1}]', "application/json")
        else:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        action = self.path.rsplit("/", 1)[-1]
        FakeAgent.calls.append((self.path, self.headers["Authorization"], action, body))
        if action == "ask":
            reply = {"text": json.dumps(ANSWER), "usage": {"prompt": 10, "reply": 5}}
            self._send(
                json.dumps({**reply, "model": "fake", "ms": 1}).encode(),
                "application/json",
            )
        elif action == "translate":
            translations = {
                t: [f"[{t}] {s}" for s in body["sentences"]] for t in body["targets"]
            }
            self._send(
                json.dumps({"translations": translations, "ms": 1}).encode(),
                "application/json",
            )
        elif action == "publish":
            self._send(b'{"turns": 1}', "application/json")
        elif action == "review":
            self._send(b'{"next_review_seconds": 1500}', "application/json")
        elif action == "speak":
            self._send(b"ID3fake", "audio/mpeg")

    def _send(self, data, content_type):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class CloudflareProvider(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.agent = ThreadingHTTPServer(("127.0.0.1", 0), FakeAgent)
        threading.Thread(target=cls.agent.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.agent.shutdown()
        cls.agent.server_close()

    def setUp(self):
        FakeAgent.calls = []
        self.config = copy.deepcopy(CONFIG)
        self.config["provider"]["name"] = "cloudflare"
        self.config["cloudflare"]["url"] = (
            f"http://127.0.0.1:{self.agent.server_address[1]}"
        )
        self.config["languages"].update(official="both", include_visitor_language=False)
        self.config["notebooks"]["enabled"] = False
        # A run folder per test under the app's runs/, since two turns in one second would share
        # a folder name.
        desktop = Path(server.__file__).parent
        (desktop / "runs").mkdir(exist_ok=True)
        runs = Path(tempfile.mkdtemp(prefix="test-cloudflare-", dir=desktop / "runs"))
        self.addCleanup(shutil.rmtree, runs)
        self.config["output"].update(
            show_prompts=False, runs_dir=str(runs.relative_to(desktop))
        )

    def turn(self, text):
        with mock.patch.dict(os.environ, {"BEAVER_AGENT_TOKEN": TOKEN}):
            return list(server.ask_events(self.config, {"text": text}))

    def test_a_turn_sends_only_guarded_text_to_the_agent(self):
        events = self.turn("my phone number is 613 555 0142, what is poutine?")
        self.assertEqual(events[-1]["type"], "done", events[-1])
        # The question and every sentence to speak are guarded. The translate request carries the
        # model's own answer before the reply guard, as the Gemini path does: that text came from
        # the agent, so it shows the agent nothing new.
        bodies = {action: [] for action in ("ask", "translate", "speak", "publish")}
        for _, _, action, body in FakeAgent.calls:
            bodies[action].append(body)
        self.assertNotIn("0142", json.dumps(bodies["ask"] + bodies["speak"]))
        self.assertTrue(
            all(auth == f"Bearer {TOKEN}" for _, auth, _, _ in FakeAgent.calls)
        )
        self.assertTrue(
            all(
                path.startswith("/agents/beaver-guide/desktop/")
                for path, *_ in FakeAgent.calls
            )
        )
        spoken = [
            body["text"] for _, _, action, body in FakeAgent.calls if action == "speak"
        ]
        self.assertEqual(len(spoken), 4)  # two sentences, in English and French
        sentences = [e for e in events if e["type"] == "sentence"]
        self.assertTrue(all(e["audio"].endswith(".mp3") for e in sentences))

    def test_a_language_melotts_lacks_shows_without_audio(self):
        self.config["languages"].update(official="en", include_visitor_language=True)
        ANSWER["visitor_language_code"] = "uk"
        ANSWER["visitor_language_name"] = "Ukrainian"
        try:
            events = self.turn("Що таке путін?")
        finally:
            ANSWER["visitor_language_code"] = "en"
            ANSWER["visitor_language_name"] = "English"
        sentences = [e for e in events if e["type"] == "sentence"]
        self.assertTrue(
            any(e["code"] == "uk" and e["audio"] is None for e in sentences)
        )
        spoken = {
            body["lang"] for _, _, action, body in FakeAgent.calls if action == "speak"
        }
        self.assertEqual(spoken, {"en"})

    def published(self):
        """The turn the server published in the background, waiting up to two seconds."""
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            bodies = [b for _, _, action, b in FakeAgent.calls if action == "publish"]
            if bodies:
                return bodies[0]
            time.sleep(0.02)
        self.fail("no turn was published")

    def test_the_published_turn_holds_guarded_text_only(self):
        self.turn("my phone number is 613 555 0142, what is poutine?")
        turn = self.published()
        self.assertNotIn("0142", json.dumps(turn))
        self.assertEqual(
            turn["question"], "my phone number is a phone number, what is poutine?"
        )
        self.assertEqual(turn["visitor"], {"name": "English", "code": "en"})
        self.assertEqual(
            [(s["group"], s["code"]) for s in turn["sentences"]],
            [(0, "en"), (0, "fr"), (1, "en"), (1, "fr")],
        )

    def test_the_agent_files_the_turn_in_place_of_the_laptop(self):
        self.config["notebooks"]["enabled"] = True
        with mock.patch("server.notebooks.file_exchange") as local_filing:
            events = self.turn("my phone number is 613 555 0142, what is poutine?")
        local_filing.assert_not_called()
        self.assertFalse(any(e["type"] == "notebook" for e in events))
        filing = self.published()["notebook"]
        self.assertIn("${notebooks}", filing["prompt"])
        self.assertNotIn("0142", json.dumps(filing))
        self.assertEqual(
            filing["answer"],
            "Poutine comes from Quebec. Call a phone number for a table.",
        )
        self.assertIn("poutine", filing["pieces"])

    def test_notebook_routes_read_from_the_agent(self):
        app = server.App(self.config)
        app.config = self.config
        local = ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(app))
        threading.Thread(target=local.serve_forever, daemon=True).start()
        self.addCleanup(local.server_close)
        self.addCleanup(local.shutdown)
        base = f"http://127.0.0.1:{local.server_address[1]}/api/notebooks"
        with mock.patch.dict(os.environ, {"BEAVER_AGENT_TOKEN": TOKEN}):
            with urllib.request.urlopen(base) as response:
                self.assertEqual(
                    json.loads(response.read()), [{"id": "ab12cd34", "entries": 1}]
                )
            with self.assertRaises(urllib.error.HTTPError) as missing:
                urllib.request.urlopen(base + "/nope")
        self.assertEqual(missing.exception.code, 404)
        paths = [path for path, auth, action, _ in FakeAgent.calls if action == "get"]
        self.assertEqual(
            paths,
            [
                "/agents/beaver-guide/desktop/notebooks",
                "/agents/beaver-guide/desktop/notebooks/nope",
            ],
        )

    def test_filing_carries_the_first_review_interval(self):
        self.config["notebooks"]["enabled"] = True
        self.config["review"]["first_interval_seconds"] = 120
        with mock.patch("server.notebooks.file_exchange"):
            self.turn("what is poutine?")
        self.assertEqual(self.published()["notebook"]["review_first_seconds"], 120)

    def test_review_route_is_local_and_checks_its_fields(self):
        app = server.App(self.config)
        app.config = self.config
        local = ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(app))
        threading.Thread(target=local.serve_forever, daemon=True).start()
        self.addCleanup(local.server_close)
        self.addCleanup(local.shutdown)
        url = f"http://127.0.0.1:{local.server_address[1]}/api/review"

        def post(body, headers):
            request = urllib.request.Request(
                url, data=json.dumps(body).encode(), headers=headers, method="POST"
            )
            try:
                with urllib.request.urlopen(request) as response:
                    return response.status, json.loads(response.read())
            except urllib.error.HTTPError as error:
                return error.code, None

        with mock.patch.dict(os.environ, {"BEAVER_AGENT_TOKEN": TOKEN}):
            self.assertEqual(post({"id": 1, "remembered": True}, {})[0], 403)
            local_page = {"X-Beaver": "1"}
            self.assertEqual(post({"id": "1", "remembered": True}, local_page)[0], 400)
            self.assertEqual(post({"id": 1, "remembered": 1}, local_page)[0], 400)
            status, body = post({"id": 1, "remembered": True}, local_page)
        self.assertEqual((status, body), (200, {"next_review_seconds": 1500}))
        reviews = [b for _, _, action, b in FakeAgent.calls if action == "review"]
        self.assertEqual(reviews, [{"id": 1, "remembered": True}])

    def test_socket_url_follows_the_viewer_link(self):
        link = "https://beaver-agent.example.dev/session.html?s=desktop&key=abc"
        self.assertEqual(
            cloudflare.socket_url(link),
            "wss://beaver-agent.example.dev/agents/beaver-guide/desktop?key=abc",
        )

    def test_viewer_key_matches_the_worker(self):
        # agent/test/turns.test.ts asserts the same key for the same inputs.
        key = cloudflare.viewer_key("secret", "desktop")
        self.assertEqual(len(key), 32)
        self.assertNotEqual(key, cloudflare.viewer_key("secret", "other"))
        with mock.patch.dict(os.environ, {"BEAVER_AGENT_TOKEN": "secret"}):
            link = cloudflare.viewer_link(self.config)
        self.assertTrue(link.endswith(f"/session.html?s=desktop&key={key}"))
        self.assertNotIn("secret", link)

    def test_session_card_needs_cloudflare_and_a_token(self):
        with mock.patch.dict(os.environ, {"BEAVER_AGENT_TOKEN": "secret"}):
            self.assertIn("qr_svg", server._session_state(self.config))
            self.config["provider"]["name"] = "gemini"
            self.assertEqual(server._session_state(self.config), {"link": None})
        self.config["provider"]["name"] = "cloudflare"
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertIn("note", server._session_state(self.config))

    def test_missing_token_stops_before_any_request(self):
        with mock.patch.dict(os.environ, {}, clear=True), self.assertRaises(SystemExit):
            cloudflare.translate(self.config, mock.MagicMock(), ["a"], "en", ["fr"])
        self.assertEqual(FakeAgent.calls, [])


if __name__ == "__main__":
    unittest.main()
