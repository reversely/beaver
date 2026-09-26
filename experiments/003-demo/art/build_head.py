"""Turn the rover's printed head shell into a light GLB for the demo page.

Run from the repo root:
    uv run --with trimesh --with fast-simplification --with numpy \
        python experiments/003-demo/art/build_head.py

Sources: art/source/head-left.stl.gz and head-right.stl.gz, the two printed halves of the head
(binary STL, millimetres). The halves overlap by about 10 mm where they join.

Output: art/head.glb, both halves merged, centred on the origin, turned so the face looks down +z
with y up, and simplified from about 82,000 to 16,000 triangles.
"""

import gzip
import io
from pathlib import Path

import numpy as np
import trimesh

ART = Path(__file__).parent
FACES = 16000


def load_half(name: str) -> trimesh.Trimesh:
    with gzip.open(ART / "source" / name, "rb") as f:
        return trimesh.load(io.BytesIO(f.read()), file_type="stl")


def main() -> None:
    head = trimesh.util.concatenate(
        [load_half("head-left.stl.gz"), load_half("head-right.stl.gz")]
    )
    head.merge_vertices()
    head = head.simplify_quadric_decimation(face_count=FACES)
    head.apply_translation(-head.bounds.mean(axis=0))
    # The printed face points down -z; a half turn about y makes it face the viewer.
    head.apply_transform(trimesh.transformations.rotation_matrix(np.pi, [0, 1, 0]))
    out = ART / "head.glb"
    head.export(out)
    size = head.bounds[1] - head.bounds[0]
    print(
        f"{out.name}: {len(head.faces)} triangles, {size.round(1)} mm, {out.stat().st_size // 1024} KB"
    )


if __name__ == "__main__":
    main()
