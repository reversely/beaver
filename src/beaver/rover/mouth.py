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

# The mouth is the prototype's screen picture (the 48 by 28 dot grid the web model first drew),
# copied cell for cell and scaled evenly onto the OLED. At rest it is a lip line rising from the
# teeth to each top corner and two solid teeth. While Beaver speaks, a lower lip in the same cells
# drops below the teeth, and the teeth stay where they are.
GRID_COLS = 48
LIP_LINE = [
    (3, 3),
    (4, 3),
    (5, 4),
    (6, 4),
    (7, 4),
    (8, 5),
    (9, 5),
    (10, 5),
    (11, 6),
    (12, 6),
]
TEETH_COLS = (13, 34)
TEETH_ROWS = (7, 24)
TOOTH_GAP_COL = 23
# The picture's lit cells span columns 3 to 44 and rows 3 to 24; each cell is SCALE dots square.
FIRST_COL, LAST_COL, FIRST_ROW = 3, 44, 3
SCALE = 1.5
# Grid rows below the teeth that the lower lip drops through, from just under them to fully open.
LIP_CLOSED_ROW = TEETH_ROWS[1] + 2
LIP_OPEN_ROW = FIRST_ROW + int(VISIBLE / SCALE) - 1


def _picture(openness: float) -> set[tuple[int, int]]:
    """The lit (column, row) cells of the grid picture at this openness."""
    cells = set()
    for col, row in LIP_LINE:
        cells |= {(col, row), (GRID_COLS - 1 - col, row)}
    left, right = TEETH_COLS
    top, bottom = TEETH_ROWS
    for row in range(top, bottom + 1):
        for col in range(left, right + 1):
            # Each tooth's two bottom corners are cut, as in the picture.
            corner = row == bottom and col in (left, right, TOOTH_GAP_COL + 1)
            gap = col == TOOTH_GAP_COL and row > top
            if not (corner or gap):
                cells.add((col, row))
    if openness > 0:
        # The lower lip: flat under the teeth, rising steeply to meet the lip line at each corner.
        lip_row = LIP_CLOSED_ROW + (LIP_OPEN_ROW - LIP_CLOSED_ROW) * openness
        mid = (FIRST_COL + LAST_COL) / 2
        half = (LAST_COL - FIRST_COL) / 2
        rows = {
            col: round(lip_row - (lip_row - FIRST_ROW) * (abs(col - mid) / half) ** 5)
            for col in range(FIRST_COL, LAST_COL + 1)
        }
        for col, row in rows.items():
            # Fill down to the next column's row so steep sides stay joined.
            nearer = rows.get(col + 1 if col < mid else col - 1, row)
            for fill in range(min(row, nearer), max(row, nearer) + 1):
                cells.add((col, fill))
    return cells


def frame(openness: float) -> np.ndarray:
    """The mouth as 64 rows of 128 dots in panel order, closed at 0 and fully open at 1."""
    openness = min(max(openness, 0.0), 1.0)
    cells = _picture(openness)
    seen = np.zeros((H, W), dtype=bool)
    left = round((W - (LAST_COL - FIRST_COL + 1) * SCALE) / 2)
    for y in range(VISIBLE):
        row = FIRST_ROW + int(y / SCALE)
        for x in range(W):
            col = FIRST_COL + int((x - left) / SCALE) if x >= left else -1
            seen[y, x] = (col, row) in cells
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
            try:
                self._command(0xB0 | index, 0x00, 0x10)
                os.write(self.fd, b"\x40" + page)
            except OSError:
                # A failed write on the shared bus loses one page of one frame; the page is sent
                # again next frame, and the speech carries on.
                self.pages[index] = None
                continue
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
    global _reported
    try:
        return Mouth(config)
    except OSError as error:
        if not _reported:
            print(f"mouth: OLED unavailable ({error}); speaking without it")
            _reported = True
        return None


_reported = False
