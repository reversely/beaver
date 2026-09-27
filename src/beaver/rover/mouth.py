"""Beaver's mouth on the rover's 128x64 OLED: buck-teeth frames, a speech-driven openness track, and
the I2C writer.

The panel is an SSD1306 at 0x3C with its colours fixed in the glass: rows 0-15 are yellow and rows
16-63 blue, with a physical gap at row 16. The panel is mounted upside down, so the mouth is drawn
the way a visitor sees it and turned 180 degrees before sending. It stays in the blue rows, which a
visitor sees as the top 47 rows.
"""

import fcntl
import os
import time

import numpy as np

W, H = 128, 64
TOP = 17
PAGES = H // 8
# Rows as a visitor sees them: blue from 0 to 46, then the gap and the yellow band.
VISIBLE = H - TOP

CENTRE = (W - 1) / 2
# The mouth's corners. Between them the upper lip is two cheeks that bulge down and meet in a point
# above the teeth; the lower lip runs down steep sides to a rounded bottom that drops as the mouth
# opens.
CORNER_X = 16
CORNER_Y = 3
CHEEK_DROP = 10
# How far below the corners the cheeks meet above the teeth.
CUSP_DROP = 4
LOWER_CLOSED_Y = 35
OPEN_DROP = 9
# Two solid teeth with a two-dot gap between them, hanging a dot below the cheeks.
TOOTH_WIDTH = 18
TOOTH_GAP = 2
TOOTH_BOTTOM = 32
TOOTH_RADIUS = 4

_cols = np.arange(W)
_rows = np.arange(H)[:, None]
# Each column's distance from the centre: 0 at the centre, 1 at a corner.
_reach = np.abs(_cols - CENTRE) / (CENTRE - CORNER_X)
_inside = _reach <= 1


def _cheeks() -> np.ndarray:
    """The upper lip's row per column: down from each corner to a cheek's bottom, up to the centre."""
    # Squaring the distance from the corner moves each cheek's bottom inward, over its tooth.
    towards_centre = np.clip(1 - _reach, 0, 1)
    bulge = np.sin(np.pi * towards_centre**2) ** 0.6
    return CORNER_Y + CUSP_DROP * towards_centre + CHEEK_DROP * bulge


def _lower_lip(bottom_y: float) -> np.ndarray:
    """The lower lip's row per column: bottom_y across the middle, rising steeply to the corners."""
    return bottom_y - (bottom_y - CORNER_Y) * np.clip(_reach, 0, 1) ** 4


def _stroke(frame: np.ndarray, ys: np.ndarray, thickness: int = 2) -> None:
    """Light a curve given as one row per column between the corners, joining steep steps."""
    ys = np.round(ys).astype(int)
    for x in _cols[_inside]:
        y1 = ys[x + 1] if x + 1 < W and _inside[x + 1] else ys[x]
        low, high = min(ys[x], y1), max(ys[x], y1)
        frame[low : high + thickness, x] = True


def _tooth(frame: np.ndarray, left: int, cheeks: np.ndarray) -> None:
    """A solid tooth from a dot below the cheeks down to its rounded bottom corners."""
    right = left + TOOTH_WIDTH - 1
    dx = np.maximum(
        np.maximum(left + TOOTH_RADIUS - _cols, _cols - (right - TOOTH_RADIUS)), 0
    )
    dy = np.maximum(_rows - (TOOTH_BOTTOM - TOOTH_RADIUS), 0)
    top = np.round(cheeks).astype(int) + 3
    frame |= (
        (_cols >= left)
        & (_cols <= right)
        & (_rows >= top)
        & (_rows <= TOOTH_BOTTOM)
        & (dx**2 + dy**2 <= TOOTH_RADIUS**2)
    )


def frame(openness: float) -> np.ndarray:
    """The mouth as 64 rows of 128 dots in panel order, closed at 0 and fully open at 1."""
    openness = min(max(openness, 0.0), 1.0)
    seen = np.zeros((H, W), dtype=bool)
    cheeks = _cheeks()
    _stroke(seen, cheeks)
    _stroke(seen, _lower_lip(LOWER_CLOSED_Y + OPEN_DROP * openness))
    left = W // 2 - TOOTH_GAP // 2 - TOOTH_WIDTH
    _tooth(seen, left, cheeks)
    _tooth(seen, left + TOOTH_WIDTH + TOOTH_GAP, cheeks)
    seen[VISIBLE:] = False
    return seen[::-1, ::-1].copy()


def pack(frame: np.ndarray) -> list[bytes]:
    """SSD1306 page bytes: eight pages of 128 columns, the top row of each page in bit 0."""
    bits = frame.reshape(PAGES, 8, W).astype(np.uint8)
    weights = (1 << np.arange(8, dtype=np.uint8))[None, :, None]
    return [bytes(page) for page in (bits * weights).sum(axis=1).astype(np.uint8)]


def openness_track(
    pcm: bytes, rate: int, fps: float, quiet_dbfs: float, loud_dbfs: float
) -> list[float]:
    """One openness per frame of 16-bit mono speech, from each frame's loudness.

    The mouth opens at once on a louder frame and closes over about three frames, so it does not
    flicker between syllables."""
    samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768
    step = max(1, round(rate / fps))
    track, level = [], 0.0
    for start in range(0, len(samples), step):
        chunk = samples[start : start + step]
        dbfs = 20 * np.log10(np.sqrt(np.mean(chunk**2)) + 1e-9)
        target = float(np.clip((dbfs - quiet_dbfs) / (loud_dbfs - quiet_dbfs), 0, 1))
        level = target if target > level else level + (target - level) * 0.4
        track.append(level)
    return track


I2C_SLAVE = 0x0703
INIT = [
    0xAE,  # display off
    0xD5, 0x80,  # clock divide
    0xA8, H - 1,  # multiplex ratio
    0xD3, 0x00,  # display offset
    0x40,  # start line 0
    0x8D, 0x14,  # charge pump on
    0x20, 0x02,  # page addressing mode
    0xA1,  # segment remap: upright on this panel
    0xC8,  # COM scan descending
    0xDA, 0x12,  # COM pins for 64 rows
    0x81, 0xCF,  # contrast
    0xD9, 0xF1,  # precharge
    0xDB, 0x40,  # VCOMH
    0xA4,  # display follows RAM
    0xA6,  # normal, not inverted
    0xAF,  # display on
]  # fmt: skip


class Oled:
    """The SSD1306 over /dev/i2c-N, writing only the pages that changed since the last frame."""

    def __init__(self, bus: int, address: int):
        self.fd = os.open(f"/dev/i2c-{bus}", os.O_RDWR)
        fcntl.ioctl(self.fd, I2C_SLAVE, address)
        self.pages: list[bytes | None] = [None] * PAGES
        self._command(*INIT)

    def _command(self, *codes: int) -> None:
        os.write(self.fd, bytes([0x00, *codes]))

    def show(self, frame: np.ndarray) -> None:
        for index, page in enumerate(pack(frame)):
            if page == self.pages[index]:
                continue
            self._command(0xB0 | index, 0x00, 0x10)
            os.write(self.fd, b"\x40" + page)
            self.pages[index] = page


class Mouth:
    """Plays an openness track on the OLED in step with the audio, then closes the mouth."""

    def __init__(self, config: dict):
        self.settings = config["mouth"]
        self.oled = Oled(self.settings["bus"], self.settings["address"])
        self.frames: dict[int, np.ndarray] = {}
        self.show(0)

    def show(self, openness: float) -> None:
        # Openness is drawn in 1/16 steps, so each step's frame is drawn once and kept.
        step = round(openness * 16)
        if step not in self.frames:
            self.frames[step] = frame(step / 16)
        self.oled.show(self.frames[step])

    def speak(self, pcm: bytes, rate: int, started: float) -> None:
        """Move the mouth through the speech that began playing at time.monotonic() == started."""
        fps = self.settings["fps"]
        track = openness_track(
            pcm, rate, fps, self.settings["quiet_dbfs"], self.settings["loud_dbfs"]
        )
        for index, openness in enumerate(track):
            wait = started + index / fps - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            elif wait < -1 / fps:
                continue  # behind: skip this frame rather than fall further behind
            self.show(openness)
        self.show(0)


def open_mouth(config: dict) -> Mouth | None:
    """The rover's mouth, or None when it is turned off or the OLED cannot be reached."""
    if not config.get("mouth", {}).get("enabled"):
        return None
    try:
        return Mouth(config)
    except OSError as error:
        print(f"mouth: OLED unavailable ({error}); speaking without it")
        return None
