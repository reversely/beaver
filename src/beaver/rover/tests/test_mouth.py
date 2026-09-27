"""OLED mouth: python -m unittest discover -s src/beaver/rover/tests"""

import sys
import time
import unittest
from itertools import pairwise
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parents[1]))

import mouth
from mouth import TOP, H, W, frame, open_mouth, openness_track, pack


def tone(seconds, amplitude, rate=24000):
    t = np.arange(int(rate * seconds)) / rate
    return (amplitude * 32767 * np.sin(2 * np.pi * 220 * t)).astype(np.int16).tobytes()


class Frames(unittest.TestCase):
    def test_size_and_blue_rows_only(self):
        for openness in (0, 0.5, 1):
            drawn = frame(openness)
            self.assertEqual(drawn.shape, (H, W))
            self.assertFalse(drawn[:TOP].any(), "drew into the yellow band")
            self.assertTrue(drawn.any())

    def test_opening_lowers_the_lip(self):
        # The panel is upside down, so a lip lower on the rover sits nearer panel row 0.
        closed, open_ = frame(0), frame(1)
        self.assertFalse(np.array_equal(closed, open_))
        self.assertLess(np.nonzero(open_)[0].min(), np.nonzero(closed)[0].min())

    def test_lip_and_teeth_never_change(self):
        # Every frame keeps the rest picture, and nothing new lights up beside the teeth, since the
        # lower lip passes behind them.
        rest = frame(0)
        near = np.zeros_like(rest)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                near |= np.roll(np.roll(rest, dy, 0), dx, 1)
        for step in range(1, 17):
            drawn = frame(step / 16)
            self.assertTrue((drawn >= rest).all())
            self.assertLessEqual(int((drawn & ~rest & near).sum()), 4)

    def test_centred(self):
        columns = np.nonzero(frame(0.5).any(axis=0))[0]
        self.assertLessEqual(abs((W - 1 - columns.max()) - columns.min()), 1)

    def test_openness_is_clamped(self):
        self.assertTrue(np.array_equal(frame(-1), frame(0)))
        self.assertTrue(np.array_equal(frame(2), frame(1)))


class Packing(unittest.TestCase):
    def test_page_bits(self):
        drawn = np.zeros((H, W), dtype=bool)
        drawn[0, 0] = True  # page 0, bit 0
        drawn[15, 3] = True  # page 1, bit 7
        pages = pack(drawn)
        self.assertEqual(len(pages), 8)
        self.assertTrue(all(len(page) == W for page in pages))
        self.assertEqual(pages[0][0], 0x01)
        self.assertEqual(pages[1][3], 0x80)
        self.assertEqual(sum(map(sum, pages)), 0x81)


class Track(unittest.TestCase):
    def test_one_value_per_frame(self):
        self.assertEqual(len(openness_track(tone(1.0, 0.5), 24000, 12, -40, -12)), 12)

    def test_silence_stays_closed_and_speech_opens(self):
        pcm = tone(0.5, 0) + tone(0.5, 0.5)
        track = openness_track(pcm, 24000, 12, -40, -12)
        self.assertEqual(max(track[:6]), 0)
        self.assertGreater(track[-1], 0.9)

    def test_closes_gradually(self):
        track = openness_track(tone(0.5, 0.5) + tone(0.5, 0), 24000, 12, -40, -12)
        after = track[6:]
        self.assertTrue(0 < after[0] < 1)
        self.assertTrue(all(a >= b for a, b in pairwise(after)))


class FakeOled:
    def __init__(self):
        self.shown = []

    def show(self, drawn):
        self.shown.append(drawn)


class Speak(unittest.TestCase):
    def test_follows_the_track_and_ends_closed(self):
        face = mouth.Mouth.__new__(mouth.Mouth)
        face.settings = {"fps": 50, "quiet_dbfs": -40, "loud_dbfs": -12}
        face.oled = FakeOled()
        face.frames = {}
        face.speak(tone(0.2, 0.5), 24000, time.monotonic())
        self.assertGreaterEqual(len(face.oled.shown), 5)
        self.assertTrue(np.array_equal(face.oled.shown[-1], frame(0)))


class WriteErrors(unittest.TestCase):
    def test_failed_page_is_sent_next_frame(self):
        oled = mouth.Oled.__new__(mouth.Oled)
        oled.pages = [None] * mouth.PAGES
        writes = []
        fail = {"left": 1}

        def command(*_codes):
            if fail["left"]:
                fail["left"] -= 1
                raise OSError(121, "Remote I/O error")

        oled._command = command
        oled.fd = None
        real_write = mouth.os.write
        mouth.os.write = lambda _fd, data: writes.append(data)
        try:
            oled.show(frame(0))
            self.assertIsNone(oled.pages[0])
            oled.show(frame(0))
        finally:
            mouth.os.write = real_write
        self.assertEqual(oled.pages, pack(frame(0)))


class Opening(unittest.TestCase):
    def test_off(self):
        self.assertIsNone(open_mouth({"mouth": {"enabled": False}}))
        self.assertIsNone(open_mouth({}))

    def test_missing_bus_speaks_without_it(self):
        config = {"mouth": {"enabled": True, "bus": 999, "address": 0x3C}}
        self.assertIsNone(open_mouth(config))


if __name__ == "__main__":
    unittest.main()
