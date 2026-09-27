"""Cut the painted Ottawa master into depth layers for the three.js camera.

Run from the repo root:
    uv run --with pillow --with numpy --with opencv-python-headless \
        python demo/art/build_layers.py

Sources (GPT Image 2 generations, stored as WebP in art/source/):
    master.webp      the painted panorama: sky, hills, Parliament Hill, river, maples
    sky.webp         two painted clouds on a flat orange field
    foreground.webp  maple branches and riverbank rocks on a flat magenta field

Outputs in art/ (RGBA WebP):
    land.webp        master minus sky, with Parliament's box refilled from the land on either side
    parliament.webp  Parliament Hill's buildings cut out of the master
    clouds.webp      the two clouds, keyed off their orange field
    foreground.webp  maple branches along the top, keyed off magenta with the pink fringe removed
    leaf-1.webp, leaf-2.webp  single falling leaves cropped from the foreground source
"""

from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ART = Path(__file__).parent
SRC = ART / "source"


def load(name: str) -> np.ndarray:
    return np.asarray(Image.open(SRC / name).convert("RGB")).astype(np.float32)


def save(rgba: np.ndarray, name: str) -> None:
    Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA").save(
        ART / name, quality=88, method=6
    )


def key_alpha(
    rgb: np.ndarray, key: np.ndarray, inner: float, outer: float
) -> np.ndarray:
    """Alpha 0 within `inner` colour distance of the key, 1 beyond `outer`, a ramp between."""
    dist = np.linalg.norm(rgb - key, axis=2)
    return np.clip((dist - inner) / (outer - inner), 0, 1)


def unmix(rgb: np.ndarray, alpha: np.ndarray, key: np.ndarray) -> np.ndarray:
    """Remove the key colour blended into edge pixels, so no magenta or orange fringe remains."""
    a = np.maximum(alpha, 1e-3)[..., None]
    return np.where(a > 0.02, (rgb - (1 - a) * key) / a, rgb)


def build_land_and_parliament() -> None:
    rgb = load("master.webp")
    h, w, _ = rgb.shape
    sky_colour = rgb[20, 20]

    # Sky: the flood-filled region of near-cream pixels connected to the top edge, so cream
    # details inside the buildings stay.
    near_sky = (np.linalg.norm(rgb - sky_colour, axis=2) < 22).astype(np.uint8)
    flood = np.zeros((h + 2, w + 2), np.uint8)
    sky = near_sky.copy()
    for x in range(0, w, 16):
        if sky[0, x]:
            cv2.floodFill(sky, flood, (x, 0), 2)
    sky_mask = sky == 2
    sky_alpha = cv2.GaussianBlur((~sky_mask).astype(np.float32), (5, 5), 0)

    # Parliament: every non-sky pixel inside the buildings' box, down to the cliff top at y 705.
    box = np.zeros((h, w), bool)
    box[:705, 1150:1968] = True
    # The pale, low-saturation hills behind the buildings stay on the land layer; a hard box edge
    # through them showed as a seam once the layers moved apart.
    spread = rgb.max(axis=2) - rgb.min(axis=2)
    hills = (rgb.mean(axis=2) > 150) & (spread < 50)
    parliament = box & ~sky_mask & ~hills
    p_alpha = cv2.GaussianBlur(parliament.astype(np.float32), (3, 3), 0) * sky_alpha
    # Feather the box's left and right edges over 24 px so trees cut at the edge fade out.
    ramp = np.ones(w, np.float32)
    ramp[1150:1174] = np.linspace(0, 1, 24)
    ramp[1944:1968] = np.linspace(1, 0, 24)
    p_alpha *= ramp[None, :]
    save(np.dstack([rgb, p_alpha * 255]), "parliament.webp")

    # Land: fill the Parliament box row by row, blending the land just left and right of it, so
    # the hills and trees continue behind the buildings. Rows where either side is sky stay
    # transparent, so the painted sky shows through above the hills.
    x0, x1 = 1146, 1972
    land = rgb.copy()
    land_alpha = sky_alpha.copy()
    t = np.linspace(0, 1, x1 - x0)[:, None]
    for y in range(705):
        left, right = rgb[y, x0 - 6 : x0].mean(0), rgb[y, x1 : x1 + 6].mean(0)
        a = min(sky_alpha[y, x0 - 6 : x0].mean(), sky_alpha[y, x1 : x1 + 6].mean())
        land[y, x0:x1] = left * (1 - t) + right * t
        land_alpha[y, x0:x1] = a
    # Painterly grain over the blended strip so it does not read as a smooth gradient.
    noise = np.random.default_rng(7).normal(0, 6, (705, x1 - x0, 1))
    land[:705, x0:x1] += noise
    save(np.dstack([land, land_alpha * 255]), "land.webp")


def build_clouds() -> None:
    rgb = load("sky.webp")
    key = np.median(rgb[400:1100, :].reshape(-1, 3), axis=0)
    alpha = key_alpha(rgb, key, 40, 110)
    save(np.dstack([unmix(rgb, alpha, key), alpha * 255]), "clouds.webp")


def build_foreground() -> None:
    rgb = load("foreground.webp")
    key = np.median(rgb[400:700, 700:1300].reshape(-1, 3), axis=0)
    # Maple red sits close to magenta in RGB distance, so the key measures magenta-ness instead:
    # blue far above green. Leaves have blue at or below green and stay opaque.
    magenta = rgb[..., 2] - rgb[..., 1]
    alpha = 1 - np.clip((magenta - 40) / 60, 0, 1)
    colour = unmix(rgb, alpha, key)
    # Only the branches along the top are kept; the rocks along the bottom edge drop out.
    branches = alpha.copy()
    branches[560:] = 0
    save(np.dstack([colour, branches * 255]), "foreground.webp")
    # Two loose leaves near the bottom centre become falling-leaf sprites.
    # Only the bright orange leaf pixels are kept (green channel above 70); the rocks behind are
    # darker red-brown and drop out.
    leafy = alpha * np.clip((rgb[..., 1] - 70) / 20, 0, 1)
    for i, (x0, y0, x1, y1) in enumerate(
        [(1040, 1030, 1180, 1152), (1400, 930, 1580, 1110)], 1
    ):
        save(np.dstack([colour, leafy * 255])[y0:y1, x0:x1], f"leaf-{i}.webp")


if __name__ == "__main__":
    build_land_and_parliament()
    build_clouds()
    build_foreground()
    for f in sorted(ART.glob("*.webp")):
        print(f.name, Image.open(f).size, f.stat().st_size // 1024, "KB")
