"""Phone-location lookup: python -m unittest discover -s src/beaver/desktop/tests"""

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parents[1]))

import place
from beaver.core.settings import load_config

CONFIG = load_config(Path(__file__).parents[1] / "config.toml", [])
BOUNDARIES = place.HERE / CONFIG["places"]["dir"] / (CONFIG["places"]["file"] + ".shp")


def square(x0, y0, size):
    return [
        (x0, y0),
        (x0 + size, y0),
        (x0 + size, y0 + size),
        (x0, y0 + size),
        (x0, y0),
    ]


class Projection(unittest.TestCase):
    def test_origin_maps_to_the_false_origin(self):
        x, y = place.lambert(63.390675, -91.86666666666666)
        self.assertAlmostEqual(x, 6200000.0, places=3)
        self.assertAlmostEqual(y, 3000000.0, places=3)

    def test_east_is_larger_x_and_north_is_larger_y(self):
        ottawa, montreal = place.lambert(45.42, -75.70), place.lambert(45.50, -73.57)
        self.assertGreater(montreal[0], ottawa[0])
        self.assertGreater(place.lambert(46.0, -75.70)[1], ottawa[1])


class RayCasting(unittest.TestCase):
    def test_inside_outside_and_hole(self):
        outer, hole = square(0, 0, 10), square(4, 4, 2)
        shape = SimpleNamespace(points=outer + hole, parts=[0, len(outer)])
        self.assertTrue(place._inside(1, 1, shape))
        self.assertFalse(place._inside(11, 1, shape))
        self.assertFalse(place._inside(5, 5, shape))


@unittest.skipUnless(
    BOUNDARIES.exists(), "run `run.py getplaces` to download the boundary file"
)
class FixedPoints(unittest.TestCase):
    def test_capital_region_and_toronto(self):
        cases = {
            (45.42, -75.70): ("Ontario", "Ottawa"),
            (45.48, -75.70): ("Quebec", "Gatineau"),
            (43.65, -79.38): ("Ontario", "Toronto"),
            (45.50, -73.57): ("Quebec", "Montréal"),
        }
        for (lat, lon), expected in cases.items():
            found = place.find(CONFIG, lat, lon)
            self.assertEqual((found["province"], found["municipality"]), expected)

    def test_points_outside_canada(self):
        self.assertIsNone(place.find(CONFIG, 42.33, -83.05))  # Detroit
        self.assertIsNone(place.find(CONFIG, 43.0, -60.0))  # Atlantic, off Nova Scotia


if __name__ == "__main__":
    unittest.main()
