// Beaver, drawn part for part from the rover prototype's CAD model (#46): a base with an arch cut
// out underneath, a humped shell on top of it, a flat cross-hatched oval tail, and a forward-tilted head,
// overhanging the base on a flat bracket, with two dot eyes, a small hole on each side, and a cream arched
// face plate that wraps the lower sides, holding the camera lens and the screen, which shows the prototype's
// buck teeth and moves with speech through speakWith().
//
// The one change from the model is colour: the CAD render leaves the base, shell, tail, and bracket
// uncoloured, and here they take the head's own brown. The other colours are sampled from the render
// and the user's photo of the prototype.
// The figure faces +x and stands on y = 0.
import * as THREE from "three";

// Sampled from the CAD render of the prototype.
const BROWN = 0x684d1f;
const CREAM = 0xf5d48e;
const LENS_RING = 0x464646;
const BLACK = 0x000000;

// Extrude a side profile (x along the body, y up) across the body's width, centred on z = 0.
function extrude(shape, width, bevel) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 32,
  });
  geometry.translate(0, 0, -width / 2);
  return geometry;
}

// The base: a block whose sides show an arch cut out from underneath, leaving a leg at each end.
function baseProfile() {
  const shape = new THREE.Shape();
  shape.moveTo(-1.0, 0);
  shape.lineTo(-0.72, 0);
  shape.absarc(0.0, 0, 0.72, Math.PI, 0, true);
  shape.lineTo(0.9, 0);
  shape.lineTo(0.9, 0.62);
  shape.lineTo(-1.0, 0.62);
  shape.lineTo(-1.0, 0);
  return shape;
}

// The shell, in two layers as on the model: a full-width lower layer that rises gently, and a
// narrower hump on top of it that rises over the back half and slopes down to the head.
function shellProfile() {
  const shape = new THREE.Shape();
  shape.moveTo(-1.0, 0.62);
  shape.lineTo(0.9, 0.62);
  shape.lineTo(0.9, 0.9);
  shape.bezierCurveTo(0.4, 1.02, -0.4, 1.08, -0.85, 1.04);
  shape.quadraticCurveTo(-1.0, 1.02, -1.0, 0.9);
  shape.lineTo(-1.0, 0.62);
  return shape;
}

function humpProfile() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.95, 0.9);
  shape.lineTo(0.9, 0.9);
  shape.lineTo(0.9, 0.98);
  shape.bezierCurveTo(0.55, 1.05, 0.25, 1.5, -0.25, 1.5);
  shape.bezierCurveTo(-0.7, 1.5, -0.92, 1.2, -0.95, 1.05);
  shape.lineTo(-0.95, 0.9);
  return shape;
}

// The head's side profile: a block with its top front corner rounded.
function headProfile() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.35, -0.42);
  shape.lineTo(0.35, -0.42);
  shape.lineTo(0.35, 0.18);
  shape.quadraticCurveTo(0.35, 0.42, 0.1, 0.42);
  shape.lineTo(-0.35, 0.42);
  shape.lineTo(-0.35, -0.42);
  return shape;
}

// The face plate's outline seen from the front: square at the bottom, rounded over the top
// corners, with a small dip at the centre of its top edge as on the prototype.
function plateShape(width, height, radius) {
  const shape = new THREE.Shape();
  const r = width / 2;
  const top = height / 2;
  shape.moveTo(-r, -top);
  shape.lineTo(r, -top);
  shape.lineTo(r, top - radius);
  shape.bezierCurveTo(r, top - radius * 0.3, r - radius * 0.4, top, r - radius, top);
  shape.lineTo(0.06, top);
  shape.quadraticCurveTo(0.015, top, 0, top - 0.035);
  shape.quadraticCurveTo(-0.015, top, -0.06, top);
  shape.lineTo(-r + radius, top);
  shape.bezierCurveTo(-r + radius * 0.4, top, -r, top - radius * 0.3, -r, top - radius);
  shape.lineTo(-r, -top);
  return shape;
}

// The face plate as one piece: the front outline carried back along the head's sides, with
// rounded edges where the front turns into the sides. Behind a thin front, everything above the
// straight sides is cut away along a plane that falls toward the back, which leaves the rounded
// top as the front plate alone and gives the side wings their sloping top edges. The piece is
// solid; its hidden inside sits within the head. Local +z points out of the face, and the piece
// runs back to z = -depth.
function muzzleGeometry(width, height, radius, depth, backHeight) {
  const bevel = 0.04;
  const front = 0.05;
  const geometry = new THREE.ExtrudeGeometry(plateShape(width, height, radius), {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 6,
    curveSegments: 40,
    steps: 30,
  });
  geometry.translate(0, 0, -depth);
  const bottom = -height / 2;
  const wingTop = height / 2 - radius;
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const behind = -position.getZ(i);
    if (behind <= front) continue;
    const back = Math.min((behind - front) / (depth - front), 1);
    const limit = wingTop - (wingTop - (bottom + backHeight)) * back;
    if (position.getY(i) > limit) position.setY(i, limit);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// The tail's diagonal grooves, drawn once onto a canvas in the body's brown.
function grooveTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  context.fillStyle = "#684d1f";
  context.fillRect(0, 0, size, size);
  context.strokeStyle = "#3a2a10";
  context.lineWidth = 5;
  for (let i = -size; i <= size * 2; i += 30) {
    context.beginPath();
    context.moveTo(i, 0);
    context.lineTo(i + size, size);
    context.moveTo(i, size);
    context.lineTo(i + size, 0);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// The screen's picture, as the prototype shows it: a 41 by 24 grid of square dots with a short lip
// stroke stepping down from each top corner to a straight line across the top of two square buck
// teeth, which have a one-dot gap and rounded bottom corners. At rest nothing shows below the
// teeth. While Beaver speaks, the rover's lower lip (src/beaver/rover/mouth.py) appears under the
// teeth, as wide as the teeth, and drops with the speech's loudness.
const GRID = { W: 41, H: 24 };

function mouthFrame(openness) {
  const { W, H } = GRID;
  const lit = new Uint8Array(W * H);
  const set = (x, y) => {
    if (x >= 0 && x < W && y >= 0 && y < H) lit[y * W + x] = 1;
  };
  const mirror = (x, y) => {
    set(x, y);
    set(W - 1 - x, y);
  };
  for (const x of [5, 6, 7]) mirror(x, 6);
  for (const x of [8, 9, 10, 11]) mirror(x, 7);
  for (let x = 11; x <= 29; x++) set(x, 8);
  for (const [left, right] of [[11, 19], [21, 29]]) {
    for (let y = 8; y <= 20; y++) {
      for (let x = left; x <= right; x++) {
        if (y === 20 && (x === left || x === right)) continue;
        set(x, y);
      }
    }
  }
  if (openness > 0.05) {
    const depth = 21 + Math.round(openness * 2);
    for (let x = 11; x <= 29; x++) {
      // The lip rises at its ends toward the teeth's outer edges.
      const end = Math.min(x - 11, 29 - x);
      set(x, end === 0 ? depth - 1 : depth);
    }
  }
  return lit;
}

// The screen's canvas: each dot a square in a 16-pixel cell, inside the black glass.
function screenCanvas() {
  const cell = 16;
  const canvas = document.createElement("canvas");
  canvas.width = GRID.W * cell;
  canvas.height = GRID.H * cell;
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  let shown = -1;
  // Openness is drawn in 1/16 steps, as on the rover.
  function show(openness) {
    const step = Math.round(Math.min(Math.max(openness, 0), 1) * 16);
    if (step === shown) return;
    shown = step;
    const lit = mouthFrame(step / 16);
    context.fillStyle = "#000000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#d6e8ff";
    for (let y = 0; y < GRID.H; y++) {
      for (let x = 0; x < GRID.W; x++) {
        if (lit[y * GRID.W + x]) context.fillRect(x * cell + 3, y * cell + 3, cell - 6, cell - 6);
      }
    }
    texture.needsUpdate = true;
  }
  show(0);
  return { texture, show };
}

// Move the mouth with an <audio> element's speech, the way the rover's openness_track does: at the
// rover's 12 frames a second, closed at or below -40 dBFS and fully open at or above -12 dBFS,
// opening at once on a louder frame and closing over about three frames.
const MOUTH = { fps: 12, quietDbfs: -40, loudDbfs: -12 };
let audioContext = null;
const sources = new WeakMap();

export function speakWith(beaver, audio) {
  audioContext ??= new AudioContext();
  let source = sources.get(audio);
  if (!source) {
    source = audioContext.createMediaElementSource(audio);
    source.connect(audioContext.destination);
    sources.set(audio, source);
  }
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let level = 0;
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    const dbfs = 20 * Math.log10(Math.sqrt(sum / samples.length) + 1e-9);
    const target = Math.min(Math.max((dbfs - MOUTH.quietDbfs) / (MOUTH.loudDbfs - MOUTH.quietDbfs), 0), 1);
    level = target > level ? target : level + (target - level) * 0.4;
    beaver.userData.mouth(level);
  }, 1000 / MOUTH.fps);
  // Both "pause" and "ended" fire when the clip finishes; the mouth closes once.
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    source.disconnect(analyser);
    beaver.userData.mouth(0);
  };
  audio.addEventListener("ended", stop, { once: true });
  audio.addEventListener("pause", stop, { once: true });
  audioContext.resume();
  return audio.play();
}

export function createBeaver() {
  const matte = (color, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...extra });
  const brown = matte(BROWN);
  const black = new THREE.MeshBasicMaterial({ color: BLACK });

  const beaver = new THREE.Group();
  beaver.name = "beaver";

  beaver.add(new THREE.Mesh(extrude(baseProfile(), 1.2, 0.03), brown));
  beaver.add(new THREE.Mesh(extrude(shellProfile(), 1.36, 0.05), brown));
  beaver.add(new THREE.Mesh(extrude(humpProfile(), 1.0, 0.06), brown));

  // Tail: a flat oval sticking out behind, level with where the shell meets the base.
  const tail = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 0.08, 48),
    [brown, matte(0xffffff, { map: grooveTexture() }), brown],
  );
  tail.scale.set(0.8, 1, 0.58);
  tail.position.set(-1.72, 0.8, 0);
  tail.rotation.z = -0.06;
  beaver.add(tail);

  // Head: tilted forward over the chin block.
  const head = new THREE.Group();
  head.position.set(1.25, 0.95, 0);
  head.rotation.z = -0.35;
  beaver.add(head);
  head.add(new THREE.Mesh(extrude(headProfile(), 0.95, 0.04), brown));
  // The flat bracket the head rests on, running back under the shell's front.
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.025, 0.7), brown);
  bracket.position.set(-0.12, -0.45, 0);
  head.add(bracket);
  for (const side of [-1, 1]) {
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.02, 16), black);
    hole.position.set(-0.05, 0.08, side * 0.522);
    hole.rotation.y = side > 0 ? 0 : Math.PI;
    head.add(hole);
  }

  // The face, on the head's front: local +z points out of the face.
  const face = new THREE.Group();
  face.position.set(0.43, 0, 0);
  face.rotation.y = Math.PI / 2;
  head.add(face);
  // The plate spans the head's width plus the wings' thickness, from the head's bottom to just
  // below the eyes, and wraps back half the head's length.
  const plate = new THREE.Mesh(muzzleGeometry(1.04, 0.66, 0.34, 0.5, 0.26), matte(CREAM));
  plate.position.set(0, -0.11, -0.03);
  face.add(plate);
  const lensRing = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.018, 12, 32), matte(LENS_RING));
  lensRing.position.set(0, 0.08, 0.035);
  face.add(lensRing);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.055, 32), black);
  lens.position.set(0, 0.08, 0.033);
  face.add(lens);
  const oled = screenCanvas();
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.245), new THREE.MeshBasicMaterial({ map: oled.texture }));
  beaver.userData.mouth = oled.show;
  screen.position.set(0, -0.2, 0.02);
  face.add(screen);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.CircleGeometry(0.035, 20), black);
    eye.position.set(side * 0.2, 0.37, 0.001);
    face.add(eye);
  }

  beaver.traverse((part) => {
    if (part.isMesh) part.castShadow = true;
  });
  return beaver;
}
