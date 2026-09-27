"""One-port routes and rover control checks: python -m unittest discover -s src/beaver/desktop/tests"""

import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parents[1]))

import server
from beaver.core.settings import load_config

CONFIG = load_config(Path(__file__).parents[1] / "config.toml", [])


class Routes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(
            ("127.0.0.1", 0), server.make_handler(server.App(CONFIG))
        )
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def request(self, path, method="GET", headers=None):
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{path}", method=method, headers=headers or {}
        )
        opener = urllib.request.build_opener(NoRedirect)
        try:
            with opener.open(request) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()

    def test_demo_is_home_and_app_is_under_app(self):
        status, body = self.request("/")
        self.assertEqual(status, 200)
        self.assertIn(b"reveal", body)
        status, body = self.request("/app/")
        self.assertEqual(status, 200)
        self.assertIn(b'id="rover"', body)
        self.assertEqual(self.request("/app")[0], 301)

    def test_paths_cannot_leave_their_folders(self):
        for path in ("/../.env", "/app/../../rover_sync.py", "/app/%2e%2e/config.toml"):
            self.assertEqual(self.request(path)[0], 404, path)

    def test_rover_control_needs_the_local_host_and_header(self):
        state = {"state": "stopped", "address": None, "log": []}
        with mock.patch.object(
            server.rover_phone, "start", return_value=state
        ) as start:
            self.assertEqual(self.request("/api/rover/start", "POST")[0], 403)
            forged = {"Host": "rebound.example", "X-Beaver": "1"}
            self.assertEqual(self.request("/api/rover/start", "POST", forged)[0], 403)
            start.assert_not_called()
            status, body = self.request("/api/rover/start", "POST", {"X-Beaver": "1"})
            self.assertEqual((status, json.loads(body)["state"]), (200, "stopped"))
        with mock.patch.object(server.rover_phone, "status", return_value=state):
            self.assertEqual(
                self.request("/api/rover", headers={"Host": "rebound.example"})[0], 403
            )

    def test_unreachable_rover_is_a_state(self):
        failure = server.subprocess.CalledProcessError(255, "ssh", stderr="timed out")
        with mock.patch.object(server.rover_phone, "status", side_effect=failure):
            status, body = self.request("/api/rover")
        self.assertEqual((status, json.loads(body)["state"]), (200, "unreachable"))

    def test_running_state_carries_a_qr_code(self):
        state = server._rover_state(
            {
                "state": "running",
                "address": "https://a.trycloudflare.com/?t=x",
                "log": [],
            }
        )
        self.assertTrue(state["qr_svg"].startswith("<svg"))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


if __name__ == "__main__":
    unittest.main()
