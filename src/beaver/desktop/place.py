"""Map the phone's rounded location to a province and municipality, entirely on this laptop.

The lookup reads Statistics Canada's 2021 census subdivision digital boundary file, which
`run.py getplaces` downloads once into a gitignored folder, so coordinates never go to a
geocoding service. The digital file keeps each subdivision's water area, so a point on a river
between two cities still falls inside one of them; the 156 MB cartographic file clips to the
shoreline and was not needed.

Source: Statistics Canada, 2021 Census Subdivision Boundary File (digital, lcsd000a21a_e),
reproduced and distributed on an "as is" basis with the permission of Statistics Canada, under the
Statistics Canada Open Licence.
"""

import io
import itertools
import json
import math
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).parent

# PRUID in the boundary file -> province or territory.
PROVINCES = {
    "10": "Newfoundland and Labrador",
    "11": "Prince Edward Island",
    "12": "Nova Scotia",
    "13": "New Brunswick",
    "24": "Quebec",
    "35": "Ontario",
    "46": "Manitoba",
    "47": "Saskatchewan",
    "48": "Alberta",
    "59": "British Columbia",
    "60": "Yukon",
    "61": "Northwest Territories",
    "62": "Nunavut",
}

# NAD83 / Statistics Canada Lambert (EPSG:3347), as the file's .prj states it.
A = 6378137.0
INV_F = 298.257222101
E = math.sqrt((2 - 1 / INV_F) / INV_F)
LAT1, LAT2, LAT0 = map(math.radians, (49.0, 77.0, 63.390675))
LON0 = math.radians(-91.86666666666666)
FALSE_EASTING, FALSE_NORTHING = 6200000.0, 3000000.0


def _m(phi):
    return math.cos(phi) / math.sqrt(1 - (E * math.sin(phi)) ** 2)


def _t(phi):
    s = E * math.sin(phi)
    return math.tan(math.pi / 4 - phi / 2) / ((1 - s) / (1 + s)) ** (E / 2)


# Lambert conformal conic with two standard parallels (Snyder, Map Projections, eq. 15-7 to 15-10).
_N = (math.log(_m(LAT1)) - math.log(_m(LAT2))) / (
    math.log(_t(LAT1)) - math.log(_t(LAT2))
)
_F = _m(LAT1) / (_N * _t(LAT1) ** _N)
_RHO0 = A * _F * _t(LAT0) ** _N


def lambert(lat: float, lon: float) -> tuple[float, float]:
    """Project a NAD83 latitude and longitude (WGS84 differs by under 2 m) to the file's metres."""
    rho = A * _F * _t(math.radians(lat)) ** _N
    theta = _N * (math.radians(lon) - LON0)
    return (
        FALSE_EASTING + rho * math.sin(theta),
        FALSE_NORTHING + _RHO0 - rho * math.cos(theta),
    )


def _inside(x: float, y: float, shape) -> bool:
    """Even-odd ray casting over every ring, so holes (an enclave inside a municipality) count as
    outside."""
    inside = False
    starts = [*shape.parts, len(shape.points)]
    for start, end in itertools.pairwise(starts):
        ring = shape.points[start:end]
        for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1], strict=True):
            if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                inside = not inside
    return inside


def _stem(config: dict) -> Path:
    return HERE / config["places"]["dir"] / config["places"]["file"]


def find(config: dict, lat: float, lon: float) -> dict | None:
    """{"province", "municipality", "csduid"} for a point, or None outside Canada's subdivisions.
    Reads only the shapes whose bounding box holds the point, so nothing is loaded in advance."""
    import shapefile

    stem = _stem(config)
    if not stem.with_suffix(".shp").exists():
        raise SystemExit("The boundary file is missing; run `run.py getplaces` first")
    x, y = lambert(lat, lon)
    # The file ships no .cpg; its names are Latin-1 ("Montr\xe9al"), not UTF-8.
    with shapefile.Reader(str(stem), encoding="latin-1") as reader:
        # With a bbox, iterShapes skips non-overlapping shapes, so each shape's oid, not a
        # counter, names its record.
        for shape in reader.iterShapes(bbox=(x, y, x, y)):
            if shape is not None and _inside(x, y, shape):
                record = reader.record(shape.oid)
                return {
                    "province": PROVINCES.get(record["PRUID"], record["PRUID"]),
                    "municipality": record["CSDNAME"],
                    "csduid": record["CSDUID"],
                }
    return None


def download(config: dict) -> Path:
    """Fetch and unpack the boundary file (40 MB zipped); keeps only the parts pyshp reads."""
    settings = config["places"]
    folder = HERE / settings["dir"]
    folder.mkdir(exist_ok=True)
    with urllib.request.urlopen(settings["url"], timeout=120) as response:
        archive = zipfile.ZipFile(io.BytesIO(response.read()))
    for suffix in (".shp", ".shx", ".dbf", ".prj"):
        name = settings["file"] + suffix
        (folder / name).write_bytes(archive.read(name))
    projection = (folder / (settings["file"] + ".prj")).read_text()
    if "Statistics_Canada_Lambert" not in projection:
        raise SystemExit(
            "The boundary file is not in Statistics Canada Lambert; lookups would be wrong"
        )
    return folder


def remember(config: dict, location: dict, rover_run: str) -> dict | None:
    """Look up the rover's latest location and save the result for the page as phone-place.json."""
    found = find(config, location["lat"], location["lon"])
    if found is None:
        return None
    state = {
        **found,
        "lat": location["lat"],
        "lon": location["lon"],
        "rover_run": rover_run,
    }
    (HERE / config["places"]["dir"] / "phone-place.json").write_text(json.dumps(state))
    return state


def last(config: dict) -> dict | None:
    path = HERE / config["places"]["dir"] / "phone-place.json"
    return json.loads(path.read_text()) if path.exists() else None
