// Low-poly notebook pieces, built in millimetres from the registry in artifact-specs.js and
// scaled to scene units once, by MM_TO_UNIT, when each piece renders. artifacts.md records the
// source of every dimension. One offscreen renderer draws each piece once to a PNG data URL,
// because browsers cap live WebGL contexts and a sidebar can list many notebooks.
import * as THREE from "three";
import { PIECES, SPECS, THEME_PIECE, runChecks } from "./artifact-specs.js";

// 1 m = 1 scene unit.
const MM_TO_UNIT = 0.001;

const COLOUR = {
  sandstone: 0xdcc3a0,
  sandstoneDark: 0xbfa27f,
  copper: 0x6a9e8a,
  slate: 0x46505b,
  clock: 0xf6efe4,
  flagRed: 0xd52b1e,
  flagWhite: 0xfbf7f0,
  bark: 0xb5824f,
  wood: 0x9a6a3e,
  kraft: 0xb98a5a,
  fry: 0xe2b35c,
  gravy: 0x6b3a22,
  curd: 0xf3ead8,
  page: 0xfbf6ec,
  ink: 0xcbbfae,
  cover: 0x7b4428,
  canvasSky: 0xbfd29b,
  canvasBand: 0xe9a45c,
  canvasHills: 0x2c3d6e,
  canvasWater: 0x9fbf98,
  canvasGround: 0x8a4a2c,
  canvasPine: 0x3e5a2e,
  canvasTrunk: 0x3b2418,
  ice: 0xe8f1f5,
  puck: 0x26282b,
  tape: 0x2f3237,
  brass: 0xcfa64a,
  brassDark: 0xa9832f,
};

const materials = new Map();
function mat(colour, doubleSided = false) {
  const key = `${colour}-${doubleSided}`;
  if (!materials.has(key)) {
    materials.set(
      key,
      new THREE.MeshLambertMaterial({
        color: colour,
        flatShading: true,
        side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      }),
    );
  }
  return materials.get(key);
}

function mesh(geometry, colour, doubleSided = false) {
  return new THREE.Mesh(geometry, mat(colour, doubleSided));
}

// Box whose base centre sits at (x, y, z).
function block(w, h, d, colour, x = 0, y = 0, z = 0) {
  const m = mesh(new THREE.BoxGeometry(w, h, d), colour);
  m.position.set(x, y + h / 2, z);
  return m;
}

// Deterministic randomness, so a piece renders the same every time.
function seeded(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function flatShape(points, colour, z) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const m = mesh(new THREE.ShapeGeometry(shape), colour, true);
  m.position.z = z;
  return m;
}

// ---- Flag ------------------------------------------------------------------------------------

// Right half of a stylized 11-point maple leaf in a unit square centred on the origin: five points
// per side plus the top point (S18 names 11 points and gives no outline).
const LEAF_RIGHT = [
  [0.06, 0.34], [0.15, 0.4], [0.12, 0.22], [0.33, 0.3], [0.28, 0.18], [0.46, 0.14],
  [0.34, 0.02], [0.4, -0.1], [0.2, -0.08], [0.24, -0.22], [0.05, -0.14], [0.03, -0.14],
  [0.03, -0.42], [0, -0.42],
];

function flagFace(length, width) {
  const s = SPECS.flag;
  const bar = (length * ((s.length_units.mm - s.square_units.mm) / 2)) / s.length_units.mm;
  const square = length - 2 * bar;
  const g = new THREE.Group();
  const rect = (x0, x1, colour, z) =>
    flatShape([[x0, 0], [x1, 0], [x1, width], [x0, width]], colour, z);
  g.add(rect(0, bar, COLOUR.flagRed, 0), rect(bar, bar + square, COLOUR.flagWhite, 0));
  g.add(rect(bar + square, length, COLOUR.flagRed, 0));
  const leafSize = square * 0.8;
  const cx = bar + square / 2;
  const cy = width / 2;
  const outline = [[0, 0.5], ...LEAF_RIGHT, ...LEAF_RIGHT.slice().reverse().map(([x, y]) => [-x, y])];
  g.add(flatShape(outline.map(([x, y]) => [cx + x * leafSize, cy + y * leafSize]), COLOUR.flagRed, 1));
  return g;
}

function flag() {
  const s = SPECS.flag;
  const g = new THREE.Group();
  const pole = s.pole_height.mm;
  const poleMesh = mesh(new THREE.CylinderGeometry(60, 90, pole, 8), COLOUR.slate);
  poleMesh.position.y = pole / 2;
  const face = flagFace(s.length.mm, s.width.mm);
  face.position.set(90, pole - s.width.mm - 200, 0);
  g.add(poleMesh, face);
  return g;
}

// ---- Peace Tower -----------------------------------------------------------------------------

function peaceTower() {
  const s = SPECS.peace_tower;
  const g = new THREE.Group();
  const width = s.base_width.mm;
  const spireBase = s.height_to_flagpole_base.mm - s.spire_height.mm;
  const clockR = s.clock_diameter.mm / 2;
  const belfryBottom = s.clock_centre_height.mm - clockR - 1500;
  const belfryWidth = width + 600;
  g.add(block(width, belfryBottom, width, COLOUR.sandstone));
  g.add(block(belfryWidth, spireBase - belfryBottom, belfryWidth, COLOUR.sandstoneDark, 0, belfryBottom));

  const turret = s.turret_width.mm;
  const corner = belfryWidth / 2;
  for (const [x, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const top = spireBase + 3000;
    g.add(block(turret, top - (belfryBottom - 2000), turret, COLOUR.sandstoneDark, x * corner, belfryBottom - 2000, z * corner));
    const cap = mesh(new THREE.ConeGeometry(turret * 0.75, 2500, 4), COLOUR.copper);
    cap.rotation.y = Math.PI / 4;
    cap.position.set(x * corner, top + 1250, z * corner);
    g.add(cap);
  }

  for (const [x, z, ry] of [[0, 1, 0], [0, -1, Math.PI], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2]]) {
    const face = mesh(new THREE.CircleGeometry(clockR, 12), COLOUR.clock);
    face.position.set(x * (belfryWidth / 2 + 5), s.clock_centre_height.mm, z * (belfryWidth / 2 + 5));
    face.rotation.y = ry;
    g.add(face);
  }

  // A square pyramid whose base matches the shaft: ConeGeometry's radius reaches the corners.
  const spire = mesh(new THREE.ConeGeometry(width / Math.SQRT2, s.spire_height.mm, 4), COLOUR.copper);
  spire.rotation.y = Math.PI / 4;
  spire.position.y = spireBase + s.spire_height.mm / 2;
  g.add(spire);

  const pole = s.flagpole_length.mm;
  const poleMesh = mesh(new THREE.CylinderGeometry(120, 150, pole, 8), COLOUR.slate);
  poleMesh.position.y = s.height_to_flagpole_base.mm + pole / 2;
  const face = flagFace(s.flag_width.mm, s.flag_height.mm);
  face.position.set(150, s.height_to_flagpole_base.mm + pole - s.flag_height.mm - 200, 0);
  g.add(poleMesh, face);
  return g;
}

// ---- North canoe -----------------------------------------------------------------------------

function northCanoe() {
  const s = SPECS.north_canoe;
  const length = s.length.mm;
  const halfBeamMax = s.beam.mm / 2;
  const depth = s.depth.mm;
  const stem = s.stem_height.mm;
  const rocker = s.rocker.mm;
  const halfBeam = (u) => halfBeamMax * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u), 2.2)), 0.8);
  const sheer = (u) => depth + (stem - depth) * Math.pow(Math.abs(u), 4);
  const keel = (u) => rocker * Math.pow(Math.abs(u), 3);

  // A hull surface swept along the length: at each station a U-shaped section runs from one
  // gunwale, under the keel, to the other gunwale. Beam goes to zero at the stems.
  const stations = 16;
  const around = 6;
  const positions = [];
  for (let i = 0; i <= stations; i += 1) {
    const u = -1 + (2 * i) / stations;
    for (let j = 0; j <= around; j += 1) {
      const theta = -Math.PI / 2 + (Math.PI * j) / around;
      const rise = Math.pow(1 - Math.cos(theta), 0.8);
      positions.push((u * length) / 2, keel(u) + (sheer(u) - keel(u)) * rise, halfBeam(u) * Math.sin(theta));
    }
  }
  const index = [];
  const row = around + 1;
  for (let i = 0; i < stations; i += 1) {
    for (let j = 0; j < around; j += 1) {
      const a = i * row + j;
      index.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const g = new THREE.Group();
  g.add(mesh(geometry, COLOUR.bark, true));

  for (const u of [-0.45, 0, 0.45]) {
    const span = 2 * halfBeam(u);
    g.add(block(60, 40, span, COLOUR.wood, (u * length) / 2, sheer(u) - 60, 0));
  }
  const paddle = new THREE.Group();
  const paddleLength = s.paddle_length.mm;
  paddle.add(block(35, paddleLength * 0.62, 35, COLOUR.wood));
  paddle.add(block(150, paddleLength * 0.38, 20, COLOUR.wood, 0, paddleLength * 0.62));
  paddle.rotation.set(0, 0.4, Math.PI / 2 - 0.12);
  paddle.position.set(paddleLength / 2, depth - 40, -200);
  g.add(paddle);
  return g;
}

// ---- Poutine ---------------------------------------------------------------------------------

function poutine() {
  const s = SPECS.poutine;
  const g = new THREE.Group();
  const height = s.bowl_height.mm;
  // A four-sided open cylinder turned 45 degrees gives a square bowl; its radius reaches the corners.
  const bowl = mesh(
    new THREE.CylinderGeometry(s.bowl_width.mm / Math.SQRT2, s.bowl_base_width.mm / Math.SQRT2, height, 4, 1, true),
    COLOUR.kraft,
    true,
  );
  bowl.rotation.y = Math.PI / 4;
  bowl.position.y = height / 2;
  const base = mesh(new THREE.CylinderGeometry(s.bowl_base_width.mm / Math.SQRT2, s.bowl_base_width.mm / Math.SQRT2, 1, 4), COLOUR.kraft);
  base.rotation.y = Math.PI / 4;
  base.position.y = 0.5;
  g.add(bowl, base);

  const random = seeded(7);
  const dummy = new THREE.Object3D();
  const fryCount = 26;
  const fries = new THREE.InstancedMesh(
    new THREE.BoxGeometry(s.fry_length.mm, s.fry_section.mm, s.fry_section.mm),
    mat(COLOUR.fry),
    fryCount,
  );
  for (let i = 0; i < fryCount; i += 1) {
    const spread = s.bowl_base_width.mm / 2 - 10;
    dummy.position.set((random() * 2 - 1) * spread, 18 + random() * (height - 10), (random() * 2 - 1) * spread);
    dummy.rotation.set((random() - 0.5) * 0.9, random() * Math.PI, (random() - 0.5) * 0.9);
    dummy.updateMatrix();
    fries.setMatrixAt(i, dummy.matrix);
  }
  g.add(fries);

  const gravyRadius = s.bowl_width.mm * 0.36;
  const gravy = mesh(new THREE.CylinderGeometry(gravyRadius, gravyRadius * 1.08, s.gravy_depth.mm, 10), COLOUR.gravy);
  gravy.position.y = height - 4;
  g.add(gravy);

  const curdCount = 9;
  const curds = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(s.curd.mm / 2, 0), mat(COLOUR.curd), curdCount);
  for (let i = 0; i < curdCount; i += 1) {
    const angle = (i / curdCount) * Math.PI * 2 + random();
    const radius = random() * gravyRadius * 0.8;
    dummy.position.set(Math.cos(angle) * radius, height + s.gravy_depth.mm / 2, Math.sin(angle) * radius);
    dummy.rotation.set(random() * 3, random() * 3, random() * 3);
    dummy.updateMatrix();
    curds.setMatrixAt(i, dummy.matrix);
  }
  g.add(curds);
  return g;
}

// ---- Open book -------------------------------------------------------------------------------

function openBook() {
  const s = SPECS.open_book;
  const g = new THREE.Group();
  const width = s.page_width.mm;
  const height = s.page_height.mm;
  const block_ = (s.pages.mm * s.page_thickness.mm) / 2;
  const tilt = ((180 - s.opening_angle_degrees.mm) / 2) * (Math.PI / 180);
  for (const side of [-1, 1]) {
    const half = new THREE.Group();
    half.add(block(width + 3, s.cover.mm, height + 3, COLOUR.cover, (side * width) / 2));
    half.add(block(width, block_, height, COLOUR.page, (side * width) / 2, s.cover.mm));
    // Lines of text, drawn as thin strips on the top page.
    const top = s.cover.mm + block_;
    for (let line = 0; line < 13; line += 1) {
      const z = -height / 2 + 24 + line * 14.5;
      half.add(block(width - 30, 0.2, 3, COLOUR.ink, (side * width) / 2, top, z));
    }
    half.rotation.z = side * tilt;
    g.add(half);
  }
  return g;
}

// ---- Easel with The Jack Pine ----------------------------------------------------------------

function jackPinePainting(width, height, z) {
  // The painting's palette in flat shapes, in canvas coordinates (0,0 at the lower left).
  const g = new THREE.Group();
  const at = (points) => points.map(([x, y]) => [x * width, y * height]);
  g.add(flatShape(at([[0, 0], [1, 0], [1, 1], [0, 1]]), COLOUR.canvasSky, z));
  g.add(flatShape(at([[0, 0.4], [1, 0.4], [1, 0.54], [0, 0.54]]), COLOUR.canvasBand, z + 0.5));
  g.add(flatShape(at([[0, 0.34], [0.12, 0.47], [0.24, 0.39], [0.4, 0.46], [0.62, 0.42], [0.8, 0.5], [1, 0.44], [1, 0.34]]), COLOUR.canvasHills, z + 1));
  g.add(flatShape(at([[0, 0.13], [1, 0.13], [1, 0.34], [0, 0.34]]), COLOUR.canvasWater, z + 1.5));
  g.add(flatShape(at([[0, 0], [1, 0], [1, 0.1], [0.6, 0.16], [0.3, 0.12], [0, 0.15]]), COLOUR.canvasGround, z + 2));
  g.add(flatShape(at([[0.62, 0.08], [0.645, 0.08], [0.64, 0.97], [0.63, 0.97]]), COLOUR.canvasTrunk, z + 2.5));
  const layers = [[0.9, 0.18], [0.78, 0.24], [0.64, 0.2], [0.52, 0.26]];
  for (const [y, span] of layers) {
    g.add(flatShape(at([[0.63 - span / 2, y - 0.07], [0.63 + span / 2, y - 0.05], [0.64, y + 0.03]]), COLOUR.canvasPine, z + 3));
  }
  return g;
}

function easelJackPine() {
  const s = SPECS.easel_jack_pine;
  const g = new THREE.Group();
  const post = s.post_section.mm;
  const base = s.base_width.mm;
  const easelHeight = s.easel_height.mm;
  const postX = base / 2 - post;
  for (const x of [-postX, postX]) {
    g.add(block(post, easelHeight, post, COLOUR.wood, x, 0, 0));
    g.add(block(post, post, base, COLOUR.wood, x, 0, 0));
  }
  g.add(block(base, post, post, COLOUR.wood, 0, 300, 0));
  g.add(block(base, post, post, COLOUR.wood, 0, easelHeight - 300, 0));

  const ledge = s.ledge_height.mm;
  const ledgeDepth = 90;
  g.add(block(base + 200, 40, ledgeDepth, COLOUR.wood, 0, ledge, post / 2 + ledgeDepth / 2));
  const canvasBottom = ledge + 40;
  const canvasZ = post / 2 + s.canvas_depth.mm / 2 + 10;
  g.add(block(s.canvas_width.mm, s.canvas_height.mm, s.canvas_depth.mm, COLOUR.page, 0, canvasBottom, canvasZ));
  const painting = jackPinePainting(s.canvas_width.mm, s.canvas_height.mm, 0);
  painting.position.set(-s.canvas_width.mm / 2, canvasBottom, canvasZ + s.canvas_depth.mm / 2 + 1);
  g.add(painting);
  g.add(block(220, 70, 90, COLOUR.wood, 0, canvasBottom + s.canvas_height.mm, canvasZ));
  return g;
}

// ---- Hockey stick and puck -------------------------------------------------------------------

function hockey() {
  const s = SPECS.hockey;
  const g = new THREE.Group();
  const ice = mesh(new THREE.CylinderGeometry(s.ice_radius.mm, s.ice_radius.mm, 40, 12), COLOUR.ice);
  ice.position.y = -20;
  g.add(ice);

  // The blade seen from above: a strip of the rule thickness that bows by the rule curve, extruded
  // upward to the blade height. rotateX maps the shape's y to -z and the extrusion to +y.
  const length = s.blade_length.mm;
  const thickness = s.blade_thickness.mm;
  const curve = s.blade_curve.mm;
  const steps = 8;
  const outer = [];
  const inner = [];
  for (let i = 0; i <= steps; i += 1) {
    const x = (length * i) / steps;
    const bow = curve * Math.sin((Math.PI * x) / length);
    outer.push(new THREE.Vector2(x, bow));
    inner.push(new THREE.Vector2(x, bow + thickness));
  }
  const bladeShape = new THREE.Shape([...outer, ...inner.reverse()]);
  const bladeGeometry = new THREE.ExtrudeGeometry(bladeShape, { depth: s.blade_height.mm, bevelEnabled: false });
  bladeGeometry.rotateX(-Math.PI / 2);
  g.add(mesh(bladeGeometry, COLOUR.tape));

  const lie = (s.lie_angle_degrees.mm * Math.PI) / 180;
  const shaftLength = s.stick_length.mm;
  const shaft = mesh(new THREE.BoxGeometry(shaftLength, s.shaft_width.mm, s.shaft_depth.mm), COLOUR.wood);
  shaft.rotation.z = Math.PI - lie;
  shaft.position.set((-Math.cos(lie) * shaftLength) / 2, (Math.sin(lie) * shaftLength) / 2 + 20, -thickness / 2);
  g.add(shaft);

  const puck = mesh(new THREE.CylinderGeometry(s.puck_diameter.mm / 2, s.puck_diameter.mm / 2, s.puck_thickness.mm, 16), COLOUR.puck);
  // On the blade's concave front face, where a forehand carries the puck.
  puck.position.set(length * 0.55, s.puck_thickness.mm / 2, 130);
  g.add(puck);
  return g;
}

// ---- Loonie ----------------------------------------------------------------------------------

function loonie() {
  const s = SPECS.loonie;
  const g = new THREE.Group();
  const radius = s.diameter.mm / 2;
  const coin = mesh(new THREE.CylinderGeometry(radius, radius, s.thickness.mm, s.sides.mm), COLOUR.brassDark);
  coin.rotation.x = Math.PI / 2;
  // The face sits just inside a raised rim, which the darker edge colour shows.
  const face = mesh(new THREE.CylinderGeometry(radius * 0.9, radius * 0.9, s.thickness.mm + 0.1, s.sides.mm), COLOUR.brass);
  face.rotation.x = Math.PI / 2;
  g.add(coin, face);
  // The loon, as a flat inset silhouette on the face.
  const loon = [
    [-7, -1.5], [-3, -3], [4, -2.6], [7.5, -0.6], [8.5, 1.2], [7, 1.6], [5.8, 0.6], [2, 0.3],
    [-2, 1.2], [-6, 0.6],
  ];
  g.add(flatShape(loon, COLOUR.brassDark, s.thickness.mm / 2 + 0.08));
  g.rotation.set(-0.25, 0.35, 0);
  g.position.y = radius;
  return g;
}

const BUILDERS = {
  peace_tower: peaceTower,
  north_canoe: northCanoe,
  poutine,
  open_book: openBook,
  easel_jack_pine: easelJackPine,
  flag,
  hockey,
  loonie,
};

// Viewing direction per piece, from the piece's centre toward the camera.
const VIEW = {
  north_canoe: [0.9, 0.55, 1],
  flag: [0.35, 0.15, 1],
  loonie: [0, 0.1, 1],
  hockey: [0.35, 0.45, 1],
  open_book: [0.2, 1.1, 0.9],
};

for (const { name, pass } of runChecks()) {
  if (!pass) console.warn(`Artifact dimension check failed: ${name}`);
}

const cache = new Map();
let renderer = null;

export function pieceFor(notebook) {
  if (PIECES.includes(notebook.artifact)) return notebook.artifact;
  return THEME_PIECE[notebook.theme] ?? "peace_tower";
}

export function artifactImage(piece, size = 200) {
  if (!BUILDERS[piece]) piece = "peace_tower";
  const key = `${piece}@${size}`;
  if (cache.has(key)) return cache.get(key);
  let url = "";
  try {
    renderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(size, size, false);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xeef3f6, 0x9a8466, 1.4));
    const sun = new THREE.DirectionalLight(0xffe0bd, 2.2);
    sun.position.set(-5, 8, 6);
    scene.add(sun);

    const model = BUILDERS[piece]();
    model.scale.setScalar(MM_TO_UNIT);
    scene.add(model);

    // Fit the camera to the piece: pieces range from 26.5 mm to 103 m.
    const sphere = new THREE.Box3().setFromObject(model).getBoundingSphere(new THREE.Sphere());
    const fov = 30;
    const distance = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(fov / 2))) * 1.05;
    const camera = new THREE.PerspectiveCamera(fov, 1, distance / 100, distance * 10);
    const direction = new THREE.Vector3(...(VIEW[piece] ?? [0.8, 0.45, 1])).normalize();
    camera.position.copy(sphere.center).addScaledVector(direction, distance);
    camera.lookAt(sphere.center);
    renderer.render(scene, camera);
    url = renderer.domElement.toDataURL("image/png");
  } catch (error) {
    console.warn(`Artifact ${piece} did not render`, error);
  }
  cache.set(key, url);
  return url;
}
