// Low-poly Parliament Hill for the page header, flat-shaded in the palette of the photo:
// sandstone walls, copper-green roofs, a dark slate library roof, and evening light.
import * as THREE from "three";

// Scene palette (sRGB hex; three.js converts to linear for lighting). The CSS sky gradient
// behind the transparent canvas carries the blue and peach of the photo.
const PALETTE = {
  sandstone: 0xdcc3a0,
  sandstoneDark: 0xbfa27f,
  copper: 0x6a9e8a,
  copperDark: 0x4f8171,
  slate: 0x46505b,
  clock: 0xf6efe4,
  leaf: 0x5b8250,
  leafDark: 0x46693f,
  lawn: 0x9db27c,
  flag: 0xc8372d,
  brown: 0x7b4428,
};

const canvas = document.getElementById("scene");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function material(color) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

function box(w, h, d, color) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color));
}

// A four-sided pyramid, the shape of the Peace Tower spire and the Centre Block roof peaks.
function pyramid(radius, height, color, sides = 4) {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(radius, height, sides), material(color));
  mesh.rotation.y = Math.PI / sides;
  return mesh;
}

// A hipped roof: a box-section prism narrowing to a ridge.
function roof(w, h, d, color) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(w / 2 - h * 0.9, h);
  shape.lineTo(-w / 2 + h * 0.9, h);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  geometry.translate(0, 0, -d / 2);
  return new THREE.Mesh(geometry, material(color));
}

function tree(x, z, scale) {
  const group = new THREE.Group();
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9 * scale, 0), material(PALETTE.leaf));
  crown.position.y = 1.3 * scale;
  const crown2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6 * scale, 0), material(PALETTE.leafDark));
  crown2.position.set(0.5 * scale, 1.0 * scale, 0.3 * scale);
  const trunk = box(0.18 * scale, 0.8 * scale, 0.18 * scale, PALETTE.brown);
  trunk.position.y = 0.4 * scale;
  group.add(trunk, crown, crown2);
  group.position.set(x, 0, z);
  return group;
}

function parliament() {
  const hill = new THREE.Group();

  // Centre Block: a long sandstone body with a copper roof and small corner pavilions.
  const body = box(11, 2.4, 2.6, PALETTE.sandstone);
  body.position.y = 1.2;
  const bodyRoof = roof(11, 1.1, 2.6, PALETTE.copper);
  bodyRoof.position.y = 2.4;
  hill.add(body, bodyRoof);
  for (const x of [-5.2, -2.4, 2.4, 5.2]) {
    const pavilion = box(1.1, 3.1, 1.3, PALETTE.sandstoneDark);
    pavilion.position.set(x, 1.55, 1.1);
    const cap = pyramid(0.85, 1.3, PALETTE.copperDark);
    cap.position.set(x, 3.75, 1.1);
    hill.add(pavilion, cap);
  }

  // Peace Tower: shaft, belfry, clock faces, and a tall copper spire with the flag.
  const shaft = box(1.7, 6.6, 1.7, PALETTE.sandstone);
  shaft.position.set(0, 3.3, 1.3);
  const belfry = box(1.95, 1.3, 1.95, PALETTE.sandstoneDark);
  belfry.position.set(0, 7.2, 1.3);
  const spire = pyramid(1.35, 3.6, PALETTE.copper);
  spire.position.set(0, 9.65, 1.3);
  hill.add(shaft, belfry, spire);
  for (const [x, z, ry] of [[0, 2.28, 0], [0.99, 1.3, Math.PI / 2], [-0.99, 1.3, Math.PI / 2]]) {
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.42, 8), material(PALETTE.clock));
    face.position.set(x, 7.25, z);
    face.rotation.y = ry;
    hill.add(face);
  }
  const pole = box(0.05, 1.1, 0.05, PALETTE.slate);
  pole.position.set(0, 12, 1.3);
  const flag = box(0.7, 0.36, 0.03, PALETTE.flag);
  flag.position.set(0.37, 12.35, 1.3);
  hill.add(pole, flag);

  // Library of Parliament: a many-sided drum under a dark slate cone, behind and to the right.
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.9, 2.8, 10), material(PALETTE.sandstone));
  drum.position.set(7.4, 1.4, -1.6);
  const libraryRoof = pyramid(2.2, 3.4, PALETTE.slate, 10);
  libraryRoof.position.set(7.4, 4.5, -1.6);
  const lantern = pyramid(0.35, 1.4, PALETTE.slate, 6);
  lantern.position.set(7.4, 6.8, -1.6);
  hill.add(drum, libraryRoof, lantern);

  const lawn = new THREE.Mesh(new THREE.CylinderGeometry(15, 13, 1.2, 9), material(PALETTE.lawn));
  lawn.position.y = -0.3;
  hill.add(lawn);
  for (const [x, z, s] of [[-8.5, 3.5, 1.3], [-10.5, 1, 1], [10.6, 3.2, 1.2], [-6.8, 5.2, 0.9], [4.6, 5.4, 0.8]]) {
    hill.add(tree(x, z, s));
  }
  return hill;
}

function start() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  const target = new THREE.Vector3(1.2, 4.2, 0);

  scene.add(new THREE.HemisphereLight(0xdbe7ef, 0x8a7a5e, 1.3));
  // Low evening sun from the left, warm, as in the photo.
  const sun = new THREE.DirectionalLight(0xffe0bd, 2.1);
  sun.position.set(-14, 9, 10);
  scene.add(sun);

  const hill = parliament();
  scene.add(hill);

  function resize() {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  let pointerX = 0;
  window.addEventListener("pointermove", (event) => {
    pointerX = event.clientX / window.innerWidth - 0.5;
  });

  let angle = 0.35;
  function frame() {
    const goal = 0.35 + pointerX * 0.25;
    angle += (goal - angle) * 0.04;
    camera.position.set(Math.sin(angle) * 31 + 6, 8, Math.cos(angle) * 31);
    camera.lookAt(target);
    renderer.render(scene, camera);
    if (!reducedMotion) requestAnimationFrame(frame);
  }

  new ResizeObserver(() => {
    resize();
    if (reducedMotion) frame();
  }).observe(canvas);
  resize();
  frame();
}

try {
  start();
} catch {
  // Without WebGL the header keeps its sky gradient and title.
  canvas.remove();
}
