// Beaver, drawn part for part from the rover prototype's CAD model (#46): a base with an arch cut
// out underneath, a humped shell on top of it, a flat cross-hatched oval tail, a small block under
// the head, and a forward-tilted head with two dot eyes, a small hole on each side, tan lower side
// panels, and a cream arched face plate holding the camera lens and the screen, which shows the prototype's
// dot-matrix buck teeth.
//
// The one change from the model is colour: the CAD render leaves the base, shell, tail, and block
// uncoloured, and here they take the head's own brown. Every other colour is sampled from the render.
// The figure faces +x and stands on y = 0.
import * as THREE from "three";

// Sampled from the CAD render of the prototype.
const BROWN = 0x5e451a;
const TAN = 0x9a825a;
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

// The face plate: square at the bottom, a full arch on top.
function plateShape(width, height) {
  const shape = new THREE.Shape();
  const r = width / 2;
  shape.moveTo(-r, -height / 2);
  shape.lineTo(r, -height / 2);
  shape.lineTo(r, height / 2 - r);
  shape.absarc(0, height / 2 - r, r, 0, Math.PI, false);
  shape.lineTo(-r, -height / 2);
  return shape;
}

// The tail's diagonal grooves, drawn once onto a canvas in the body's brown.
function grooveTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  context.fillStyle = "#5e451a";
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

// The screen's dot-matrix picture, as on the prototype: two buck teeth side by side under a mouth
// line that rises to each top corner. Cells are lit on a 48 by 28 grid and drawn as square dots.
function screenTexture() {
  const cols = 48;
  const rows = 28;
  const lit = new Map();
  const set = (col, row, level) => lit.set(`${col},${row}`, level);
  // Mouth line: from each top corner down to the teeth's top edge.
  const line = [[3, 3], [4, 3], [5, 4], [6, 4], [7, 4], [8, 5], [9, 5], [10, 5], [11, 6], [12, 6]];
  for (const [col, row] of line) {
    set(col, row, 1);
    set(cols - 1 - col, row, 1);
  }
  // Teeth: two blocks with a one-cell gap, outlined bright, filled a little dimmer, with their
  // bottom corners cut round.
  for (const [left, right] of [[13, 23], [24, 34]]) {
    for (let row = 7; row <= 24; row++) {
      for (let col = left; col <= right; col++) {
        const corner = row === 24 && (col === left || col === right);
        if (corner) continue;
        const edge = row === 7 || row === 24 || col === left || col === right || (row === 23 && (col === left + 1 || col === right - 1));
        set(col, row, edge ? 1 : 0.72);
      }
    }
  }
  for (let row = 8; row <= 24; row++) lit.delete(`23,${row}`);

  const cell = 8;
  const canvas = document.createElement("canvas");
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  const context = canvas.getContext("2d");
  context.fillStyle = "#000000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const [key, level] of lit) {
    const [col, row] = key.split(",").map(Number);
    context.fillStyle = `rgba(226, 230, 234, ${level})`;
    context.fillRect(col * cell + 1, row * cell + 1, cell - 2, cell - 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
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
    // The tan panel over the lower half of each side, meeting the face plate.
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.42), matte(TAN));
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
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.245),
    new THREE.MeshBasicMaterial({ map: screenTexture() }),
  );
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
