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

// The head's side profile: a tall block with its top front corner rounded. The face plate covers
// the lower part of its front, the eyes sit just above the plate, and the head rises well above
// them, as on the prototype.
function headProfile() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.35, -0.42);
  shape.lineTo(0.35, -0.42);
  shape.lineTo(0.35, 0.3);
  shape.quadraticCurveTo(0.35, 0.64, 0.02, 0.64);
  shape.lineTo(-0.35, 0.64);
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
  const teeth = new Uint8Array(W * H);
  for (const [left, right] of [[11, 19], [21, 29]]) {
    for (let y = 8; y <= 20; y++) {
      for (let x = left; x <= right; x++) {
        if (y === 20 && (x === left || x === right)) continue;
        set(x, y);
        teeth[y * W + x] = 1;
      }
    }
  }
  if (openness > 0.05) {
    // As on the rover: the top lip and teeth never change. The lower lip starts at each end of the
    // top lip, runs down the sides, and drops from behind the teeth to below them with the speech.
    // The buck teeth jut out in front, so the lip is hidden over them and one dot around them.
    const bottom = 18 + openness * 5;
    const [first, last, top] = [5, W - 1 - 5, 6];
    const mid = (first + last) / 2;
    const half = (last - first) / 2;
    const row = (x) => Math.round(bottom - (bottom - top) * (Math.abs(x - mid) / half) ** 5);
    const behindTeeth = (x, y) => {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const [nx, ny] = [x + dx, y + dy];
          if (nx >= 0 && nx < W && ny >= 0 && ny < H && teeth[ny * W + nx]) return true;
        }
      }
      return false;
    };
    for (let x = first; x <= last; x++) {
      // Fill down to the next column toward the middle, so the steep sides stay joined.
      const inner = row(x < mid ? x + 1 : x > mid ? x - 1 : x);
      for (let y = Math.min(row(x), inner); y <= Math.max(row(x), inner); y++) {
        if (!behindTeeth(x, y)) set(x, y);
      }
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

  // Tail: a flat oval sticking out behind, level with where the shell meets the base, hinged where
  // it joins the body so it can wag up and down.
  const tailHinge = new THREE.Group();
  tailHinge.position.set(-1.0, 0.8, 0);
  beaver.add(tailHinge);
  const tail = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 0.08, 48),
    [brown, matte(0xffffff, { map: grooveTexture() }), brown],
  );
  tail.scale.set(0.8, 1, 0.58);
  tail.position.set(-0.72, 0, 0);
  tail.rotation.z = -0.06;
  tailHinge.add(tail);

  // The flat bracket on the base's front that the head rests on.
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.025, 0.7), brown);
  bracket.position.set(0.9, 0.645, 0);
  beaver.add(bracket);

  // Head: tilted forward as on the prototype, on a neck that pans it left and right and tilts it
  // up from its back bottom corner, which rests on the bracket. The prototype's camera sits on a
  // pan and tilt mount in the same way.
  const neck = new THREE.Group();
  neck.position.set(0.78, 0.68, 0);
  neck.rotation.order = "YZX";
  beaver.add(neck);
  const head = new THREE.Group();
  head.position.set(0.47, 0.27, 0);
  head.rotation.z = -0.35;
  neck.add(head);
  head.add(new THREE.Mesh(extrude(headProfile(), 0.95, 0.04), brown));
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
    eye.position.set(side * 0.2, 0.36, 0.001);
    face.add(eye);
  }

  beaver.traverse((part) => {
    if (part.isMesh) part.castShadow = true;
  });

  // Pan turns the face from +x toward -z; tilt raises it from resting on the bracket.
  const turn = { pan: 0, tilt: HEAD.tilt };
  beaver.userData.neck = neck;
  beaver.userData.aim = (pan, tilt) => {
    turn.pan = Math.min(Math.max(pan, -HEAD.maxPan), HEAD.maxPan);
    turn.tilt = Math.min(Math.max(tilt, 0), HEAD.maxTilt);
    neck.rotation.y = turn.pan;
    neck.rotation.z = turn.tilt;
  };
  beaver.userData.aiming = () => ({ ...turn });
  beaver.userData.aim(0, HEAD.tilt);
  // The tail wags up and down about its hinge; seconds is the time since the page started.
  beaver.userData.update = (seconds) => {
    tailHinge.rotation.z = TAIL.swing * Math.sin(2 * Math.PI * TAIL.hz * seconds);
  };
  return beaver;
}

// The head's reach: about 50 degrees either side, and up to about 30 degrees above the bracket,
// starting about 20 degrees up.
const HEAD = { maxPan: 0.9, maxTilt: 0.55, tilt: 0.35 };
// The tail's wag: about 12 degrees up and down, a little over once a second.
const TAIL = { swing: 0.22, hz: 1.2 };

// Let a drag that starts on the head pan and tilt it; any other drag is left to the page's camera
// controls, which are paused while the head is held. The head follows the pointer's direction on
// screen from any viewing angle. Returns a function that removes the listeners.
export function attachHeadDrag({ beaver, camera, element, controls }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const neck = beaver.userData.neck;
  let held = null;

  const toPointer = (event) => {
    const box = element.getBoundingClientRect();
    pointer.set(((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1);
  };
  // The on-screen direction, in pixels per unit, that a small world step from the neck moves to.
  const screenStep = (direction) => {
    const origin = neck.getWorldPosition(new THREE.Vector3());
    const a = origin.clone().project(camera);
    const b = origin.add(direction).project(camera);
    const box = element.getBoundingClientRect();
    const v = new THREE.Vector2(((b.x - a.x) * box.width) / 2, (-(b.y - a.y) * box.height) / 2);
    return v.lengthSq() > 1e-6 ? v.normalize() : v;
  };

  const down = (event) => {
    toPointer(event);
    raycaster.setFromCamera(pointer, camera);
    if (!raycaster.intersectObject(neck, true).length) return;
    const { pan, tilt } = beaver.userData.aiming();
    // Moving the pointer toward the face's left (-z) pans that way; toward screen up tilts up.
    held = { x: event.clientX, y: event.clientY, pan, tilt, side: screenStep(new THREE.Vector3(0, 0, -1)), up: screenStep(new THREE.Vector3(0, 1, 0)) };
    if (controls) controls.enabled = false;
    element.setPointerCapture(event.pointerId);
    event.stopPropagation();
  };
  const move = (event) => {
    if (!held) return;
    const dx = event.clientX - held.x;
    const dy = event.clientY - held.y;
    const rate = 0.008;
    beaver.userData.aim(
      held.pan + (dx * held.side.x + dy * held.side.y) * rate,
      held.tilt + (dx * held.up.x + dy * held.up.y) * rate,
    );
  };
  const up = (event) => {
    if (!held) return;
    held = null;
    if (controls) controls.enabled = true;
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
  };
  // Capture phase, so the head claims the drag before the camera controls see it.
  element.addEventListener("pointerdown", down, true);
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", up);
  element.addEventListener("pointercancel", up);
  return () => {
    element.removeEventListener("pointerdown", down, true);
    element.removeEventListener("pointermove", move);
    element.removeEventListener("pointerup", up);
    element.removeEventListener("pointercancel", up);
  };
}
