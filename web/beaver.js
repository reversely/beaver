// Beaver, drawn part for part from the rover prototype's CAD model (#46): a base with an arch cut
// out underneath, a humped shell on top of it, a flat cross-hatched oval tail, a small block under
// the head, and a forward-tilted head with two dot eyes, a small hole on each side, and a cream arched
// face plate that wraps the lower sides, holding the camera lens and the screen, which shows the rover's OLED
// mouth and moves with speech through speakWith().
//
// The one change from the model is colour: the CAD render leaves the base, shell, tail, and block
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

// The face plate: square at the bottom, rounded over the top, with a small dip at the centre of
// its top edge as on the prototype.
function plateShape(width, height) {
  const shape = new THREE.Shape();
  const r = width / 2;
  const top = height / 2;
  shape.moveTo(-r, -top);
  shape.lineTo(r, -top);
  shape.lineTo(r, top - r);
  shape.bezierCurveTo(r, top - r * 0.4, r * 0.5, top, 0.05, top - 0.005);
  shape.quadraticCurveTo(0.015, top - 0.01, 0, top - 0.035);
  shape.quadraticCurveTo(-0.015, top - 0.01, -0.05, top - 0.005);
  shape.bezierCurveTo(-r * 0.5, top, -r, top - r * 0.4, -r, top - r);
  shape.lineTo(-r, -top);
  return shape;
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

// The screen: the rover's 128x64 OLED mouth, ported from src/beaver/rover/mouth.py. frame() draws
// the mouth as a visitor sees it, closed at openness 0 and fully open at 1; the rover turns it 180
// degrees for its upside-down panel, which the model does not need.
const OLED = { W: 128, H: 64, TOP: 17 };
const VISIBLE = OLED.H - OLED.TOP;
const CENTRE = (OLED.W - 1) / 2;
const CORNER_X = 10;
const CORNER_Y = 3;
const CHEEK_DROP = 9;
const LOWER_CLOSED_Y = 33;
const OPEN_DROP = 11;
const TOOTH_WIDTH = 18;
const TOOTH_GAP = 2;
const TOOTH_BOTTOM = 30;
const TOOTH_RADIUS = 4;

function mouthFrame(openness) {
  openness = Math.min(Math.max(openness, 0), 1);
  const { W, H } = OLED;
  const lit = new Uint8Array(W * H);
  const reach = (x) => Math.abs(x - CENTRE) / (CENTRE - CORNER_X);
  const inside = (x) => reach(x) <= 1;
  const cheek = (x) => CORNER_Y + CHEEK_DROP * Math.sin(Math.PI * Math.min(Math.max(1 - reach(x), 0), 1));
  const bottom = LOWER_CLOSED_Y + OPEN_DROP * openness;
  const lower = (x) => bottom - (bottom - CORNER_Y) * Math.min(Math.max(reach(x), 0), 1) ** 4;
  const stroke = (curve) => {
    for (let x = 0; x < W; x++) {
      if (!inside(x)) continue;
      const y0 = Math.round(curve(x));
      const y1 = x + 1 < W && inside(x + 1) ? Math.round(curve(x + 1)) : y0;
      for (let y = Math.min(y0, y1); y < Math.max(y0, y1) + 2; y++) if (y >= 0 && y < H) lit[y * W + x] = 1;
    }
  };
  stroke(cheek);
  stroke(lower);
  const tooth = (left) => {
    const right = left + TOOTH_WIDTH - 1;
    for (let x = left; x <= right; x++) {
      const top = Math.round(cheek(x)) + 3;
      for (let y = top; y <= TOOTH_BOTTOM; y++) {
        const dx = Math.max(left + TOOTH_RADIUS - x, x - (right - TOOTH_RADIUS), 0);
        const dy = Math.max(y - (TOOTH_BOTTOM - TOOTH_RADIUS), 0);
        if (dx * dx + dy * dy <= TOOTH_RADIUS * TOOTH_RADIUS) lit[y * W + x] = 1;
      }
    }
  };
  const left = W / 2 - TOOTH_GAP / 2 - TOOTH_WIDTH;
  tooth(left);
  tooth(left + TOOTH_WIDTH + TOOTH_GAP);
  lit.fill(0, VISIBLE * W);
  return lit;
}

// The screen's canvas: the panel's dots, each a square in a 4-pixel cell, inside the black glass.
function screenCanvas() {
  const cell = 4;
  const margin = { x: 16, y: 32 };
  const canvas = document.createElement("canvas");
  canvas.width = OLED.W * cell + margin.x * 2;
  canvas.height = OLED.H * cell + margin.y * 2;
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const drawn = new Map();
  let shown = -1;
  // Openness is drawn in 1/16 steps, as on the rover, and each step's picture is kept.
  function show(openness) {
    const step = Math.round(Math.min(Math.max(openness, 0), 1) * 16);
    if (step === shown) return;
    shown = step;
    if (!drawn.has(step)) {
      const image = context.createImageData(canvas.width, canvas.height);
      const lit = mouthFrame(step / 16);
      for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
      for (let y = 0; y < OLED.H; y++) {
        for (let x = 0; x < OLED.W; x++) {
          if (!lit[y * OLED.W + x]) continue;
          for (let py = 0; py < cell - 1; py++) {
            for (let px = 0; px < cell - 1; px++) {
              const at = ((margin.y + y * cell + py) * canvas.width + margin.x + x * cell + px) * 4;
              image.data[at] = 214;
              image.data[at + 1] = 232;
              image.data[at + 2] = 255;
            }
          }
        }
      }
      drawn.set(step, image);
    }
    context.putImageData(drawn.get(step), 0, 0);
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

  // The small block under the head, at the front of the base.
  const chin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.95), brown);
  chin.position.set(1.12, 0.2, 0);
  beaver.add(chin);

  // Head: tilted forward over the chin block.
  const head = new THREE.Group();
  head.position.set(1.25, 0.95, 0);
  head.rotation.z = -0.35;
  beaver.add(head);
  head.add(new THREE.Mesh(extrude(headProfile(), 0.95, 0.04), brown));
  for (const side of [-1, 1]) {
    // The face plate's side wing over the lower half of each side, in the plate's cream.
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.42), matte(CREAM));
    panel.position.set(0.12, -0.2, side * 0.517);
    panel.rotation.y = side > 0 ? 0 : Math.PI;
    head.add(panel);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.02, 16), black);
    hole.position.set(-0.05, 0.08, side * 0.522);
    hole.rotation.y = side > 0 ? 0 : Math.PI;
    head.add(hole);
  }

  // The face, on the head's front: local +z points out of the face.
  const face = new THREE.Group();
  face.position.set(0.39, 0, 0);
  face.rotation.y = Math.PI / 2;
  head.add(face);
  const plate = new THREE.Mesh(extrude(plateShape(0.78, 0.62), 0.04, 0.015), matte(CREAM));
  plate.position.set(0, -0.1, 0.02);
  face.add(plate);
  const lensRing = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.018, 12, 32), matte(LENS_RING));
  lensRing.position.set(0, 0.06, 0.06);
  face.add(lensRing);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.055, 32), black);
  lens.position.set(0, 0.06, 0.058);
  face.add(lens);
  const oled = screenCanvas();
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.245), new THREE.MeshBasicMaterial({ map: oled.texture }));
  beaver.userData.mouth = oled.show;
  screen.position.set(0, -0.2, 0.056);
  face.add(screen);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.CircleGeometry(0.035, 20), black);
    eye.position.set(side * 0.2, 0.3, 0.001);
    face.add(eye);
  }

  beaver.traverse((part) => {
    if (part.isMesh) part.castShadow = true;
  });
  return beaver;
}
