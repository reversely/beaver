// Small low-poly pieces, one per notebook theme, rendered once each to PNG data URLs by a single
// offscreen renderer (browsers cap live WebGL contexts, so each card gets an image, not a canvas).
import * as THREE from "three";

const C = {
  sandstone: 0xdcc3a0,
  sandstoneDark: 0xbfa27f,
  copper: 0x6a9e8a,
  brown: 0x7b4428,
  brownDark: 0x5a3020,
  cream: 0xf6efe4,
  gold: 0xe2b35c,
  gravy: 0x6b3a22,
  page: 0xfbf6ec,
  flag: 0xc8372d,
};

const mat = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });

function tower() {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(1, 3, 1), mat(C.sandstone));
  shaft.position.y = 1.5;
  const belfry = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 1.2), mat(C.sandstoneDark));
  belfry.position.y = 3.35;
  const spire = new THREE.Mesh(new THREE.ConeGeometry(0.85, 2, 4), mat(C.copper));
  spire.rotation.y = Math.PI / 4;
  spire.position.y = 4.7;
  const clock = new THREE.Mesh(new THREE.CircleGeometry(0.27, 8), mat(C.cream));
  clock.position.set(0, 3.35, 0.61);
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.24, 0.03), mat(C.flag));
  flag.position.set(0.25, 5.9, 0);
  g.add(shaft, belfry, spire, clock, flag);
  g.position.y = -2.8;
  return g;
}

function canoe() {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(-2.6, 0.5);
  shape.quadraticCurveTo(-2.2, -0.4, 0, -0.45);
  shape.quadraticCurveTo(2.2, -0.4, 2.6, 0.5);
  shape.lineTo(-2.6, 0.5);
  const hull = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 4 }),
    mat(C.brown),
  );
  hull.position.z = -0.5;
  const gunwale = new THREE.Mesh(new THREE.BoxGeometry(5.1, 0.08, 1.05), mat(C.brownDark));
  gunwale.position.y = 0.5;
  const paddle = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.4, 0.08), mat(C.sandstoneDark));
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.8, 0.06), mat(C.sandstoneDark));
  blade.position.y = -1.4;
  paddle.add(shaft, blade);
  paddle.position.set(0.6, 1.1, 0.7);
  paddle.rotation.z = 0.6;
  g.add(hull, gunwale, paddle);
  return g;
}

function poutine() {
  const g = new THREE.Group();
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(2, 1.3, 1.2, 9), mat(C.cream));
  g.add(bowl);
  const fries = [[-0.8, 0.3], [0.6, -0.4], [0, 0.8], [0.9, 0.5], [-0.4, -0.7], [-1.1, -0.1]];
  fries.forEach(([x, z], i) => {
    const fry = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.3, 0.22), mat(C.gold));
    fry.position.set(x, 0.9, z);
    fry.rotation.set(0.4 * Math.sin(i * 2), i, 0.5 * Math.cos(i * 3));
    g.add(fry);
  });
  const gravy = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, 0.15, 9), mat(C.gravy));
  gravy.position.y = 0.62;
  g.add(gravy);
  [[0.3, 0.2], [-0.5, 0.5], [0.7, -0.6], [-0.2, -0.4]].forEach(([x, z]) => {
    const curd = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), mat(C.page));
    curd.position.set(x, 0.8, z);
    g.add(curd);
  });
  g.position.y = -0.3;
  return g;
}

function book() {
  const g = new THREE.Group();
  for (const side of [-1, 1]) {
    const cover = new THREE.Mesh(new THREE.BoxGeometry(2, 0.12, 2.8), mat(C.brown));
    cover.position.set(side * 1.02, 0, 0);
    cover.rotation.z = side * -0.18;
    const pages = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.28, 2.6), mat(C.page));
    pages.position.set(side * 0.98, 0.2, 0);
    pages.rotation.z = side * -0.18;
    g.add(cover, pages);
  }
  const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 1.8), mat(C.flag));
  ribbon.position.set(0.3, 0.42, 0.5);
  g.add(ribbon);
  g.rotation.x = 0.35;
  return g;
}

const BUILDERS = { civic: tower, history: canoe, culture: poutine, language: book };
const cache = new Map();
let renderer = null;

export function artifactImage(theme) {
  const key = BUILDERS[theme] ? theme : "history";
  if (cache.has(key)) return cache.get(key);
  let url = "";
  try {
    renderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(200, 200, false);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xeef3f6, 0x9a8466, 1.4));
    const sun = new THREE.DirectionalLight(0xffe0bd, 2.2);
    sun.position.set(-5, 8, 6);
    scene.add(sun);
    const piece = BUILDERS[key]();
    piece.rotation.y += -0.5;
    scene.add(piece);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 3.2, 12);
    camera.lookAt(0, 0.3, 0);
    renderer.render(scene, camera);
    url = renderer.domElement.toDataURL("image/png");
  } catch {
    url = "";
  }
  cache.set(key, url);
  return url;
}
