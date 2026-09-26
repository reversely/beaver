// Low-poly autumn city behind the slides: a river town with a copper-roofed clock tower, maples,
// falling leaves, and a beaver at its dam. Every colour mixes the five palette swatches.
import * as THREE from "three";

const PALETTE = {
  brown: "#814E2B",
  red: "#9F0A28",
  orange: "#D55C2B",
  cream: "#F6E7D3",
  sage: "#89A46F",
};

const color = (name) => new THREE.Color(PALETTE[name]);
const mix = (a, b, t) => color(a).lerp(color(b), t);

// Derived tones, each a fixed mix of two swatches.
const TONES = {
  bark: mix("brown", "red", 0.15).multiplyScalar(0.55),
  water: mix("sage", "brown", 0.35).multiplyScalar(0.8),
  field: mix("sage", "cream", 0.25),
  wall: mix("cream", "brown", 0.12),
  wallWarm: mix("cream", "orange", 0.22),
  sandstone: mix("cream", "brown", 0.3),
  copper: color("sage"),
  road: mix("cream", "brown", 0.42),
  gold: mix("orange", "cream", 0.3),
  fur: mix("brown", "red", 0.1).multiplyScalar(0.8),
  furDark: color("brown").multiplyScalar(0.45),
};

// Camera views, one per slide name (position, look-at target).
const VIEWS = {
  hero: [[-95, 62, 120], [0, 8, -22]],
  rover: [[24, 8, 38], [36, 3, 16]],
  knows: [[-22, 24, 8], [0, 26, -40]],
  signin: [[120, 55, 70], [-10, 0, -30]],
  site: [[70, 85, -125], [-5, 0, 0]],
  pair: [[-38, 9, -17], [0, 22, -42]],
  deploy: [[10, 175, 50], [-10, 0, -20]],
  session: [[-78, 6, 30], [-10, 4, 14]],
  conversation: [[52, 11, 40], [36, 3, 16]],
  notebook: [[-115, 38, -62], [0, 10, -30]],
  close: [[0, 44, 175], [0, 14, 0]],
};

const riverZ = (x) => 20 + 6 * Math.sin(x / 25);

// Seeded random so the town lays out the same on every load.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const flat = (hex, extra = {}) =>
  new THREE.MeshLambertMaterial({ color: hex, flatShading: true, ...extra });

function buildGround(random) {
  const geo = new THREE.PlaneGeometry(520, 520, 44, 44).toNonIndexed();
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  // Hills rise with distance from the town so the horizon folds under the fog.
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const d = Math.hypot(x, z + 20);
    const rise = Math.max(0, d - 120) * 0.12;
    const bump = Math.sin(x * 0.05) * Math.cos(z * 0.04) * 2.5;
    const nearRiver = Math.abs(z - riverZ(x)) < 12;
    pos.setY(i, nearRiver ? -1.2 : rise + (d > 90 ? bump : 0));
  }
  const colors = [];
  // Mostly sage with a few dry autumn patches; small brightness steps keep the facets legible.
  const tones = [TONES.field, TONES.field, color("sage"), mix("sage", "orange", 0.22)];
  for (let i = 0; i < pos.count; i += 3) {
    const c = tones[Math.floor(random() * tones.length)].clone().multiplyScalar(0.96 + random() * 0.06);
    for (let k = 0; k < 3; k++) colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, flat(0xffffff, { vertexColors: true }));
  mesh.receiveShadow = true;
  return mesh;
}

function buildRiver() {
  const pts = [];
  for (let x = -260; x <= 260; x += 6) {
    const z = riverZ(x);
    pts.push(x, -0.3, z - 8, x, -0.3, z + 8);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  const idx = [];
  for (let i = 0; i < pts.length / 6 - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, flat(TONES.water, { side: THREE.DoubleSide }));
}

function buildRoads() {
  const group = new THREE.Group();
  const mat = flat(TONES.road);
  const along = new THREE.BoxGeometry(150, 0.2, 5);
  for (const z of [-14, -66]) {
    const m = new THREE.Mesh(along, mat);
    m.position.set(0, 0.1, z);
    m.receiveShadow = true;
    group.add(m);
  }
  const across = new THREE.BoxGeometry(5, 0.2, 58);
  for (const x of [-38, 22]) {
    const m = new THREE.Mesh(across, mat);
    m.position.set(x, 0.1, -40);
    m.receiveShadow = true;
    group.add(m);
  }
  return group;
}

function buildTown(random) {
  const walls = [TONES.wall, TONES.wallWarm, TONES.sandstone, mix("cream", "red", 0.12)];
  const roofs = [color("brown"), color("red"), TONES.copper, mix("brown", "orange", 0.4)];
  const lots = [];
  for (let x = -70; x <= 70; x += 11) {
    for (let z = -84; z <= -20; z += 11) {
      const nearTower = Math.abs(x) < 16 && Math.abs(z + 42) < 16;
      const onRoad = Math.abs(z + 14) < 6 || Math.abs(z + 66) < 6 || Math.abs(x + 38) < 6 || Math.abs(x - 22) < 6;
      if (nearTower || onRoad || random() < 0.12) continue;
      lots.push([x + (random() - 0.5) * 2, z + (random() - 0.5) * 2]);
    }
  }
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const roof = new THREE.ConeGeometry(0.72, 1, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 0.5, 0);
  const wallMesh = new THREE.InstancedMesh(box, flat(0xffffff), lots.length);
  const roofMesh = new THREE.InstancedMesh(roof, flat(0xffffff), lots.length);
  const m = new THREE.Matrix4();
  lots.forEach(([x, z], i) => {
    const w = 6 + random() * 3;
    const d = 6 + random() * 3;
    const h = 5 + random() * random() * 16;
    m.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion(), new THREE.Vector3(w, h, d));
    wallMesh.setMatrixAt(i, m);
    wallMesh.setColorAt(i, walls[Math.floor(random() * walls.length)]);
    m.compose(new THREE.Vector3(x, h, z), new THREE.Quaternion(), new THREE.Vector3(w * 1.05, 2 + random() * 3, d * 1.05));
    roofMesh.setMatrixAt(i, m);
    roofMesh.setColorAt(i, roofs[Math.floor(random() * roofs.length)]);
  });
  for (const mesh of [wallMesh, roofMesh]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  const group = new THREE.Group();
  group.add(wallMesh, roofMesh);
  return group;
}

function buildTower() {
  const group = new THREE.Group();
  const stone = flat(TONES.sandstone);
  const base = new THREE.Mesh(new THREE.BoxGeometry(22, 9, 14), stone);
  base.position.y = 4.5;
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(8, 30, 8), stone);
  shaft.position.y = 24;
  const belfry = new THREE.Mesh(new THREE.BoxGeometry(9.5, 5, 9.5), flat(TONES.wall));
  belfry.position.y = 41.5;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(7.2, 14, 4), flat(TONES.copper));
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 51;
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 8, 5), flat(TONES.bark));
  spire.position.y = 62;
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.1), flat(color("red"), { side: THREE.DoubleSide }));
  flag.position.set(2.2, 64.6, 0);
  const clockFace = new THREE.CircleGeometry(2.6, 12);
  const faceMat = flat(color("cream"));
  const handMat = flat(TONES.bark);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const face = new THREE.Mesh(clockFace, faceMat);
    face.position.set(Math.sin(a) * 4.02, 34, Math.cos(a) * 4.02);
    face.rotation.y = a;
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2, 0.1), handMat);
    hand.position.set(Math.sin(a) * 4.1, 34.6, Math.cos(a) * 4.1);
    hand.rotation.y = a;
    group.add(face, hand);
  }
  for (const mesh of [base, shaft, belfry, roof]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  group.add(base, shaft, belfry, roof, spire, flag);
  group.position.set(0, 0, -42);
  return { group, flag };
}

function buildMaples(random) {
  const spots = [];
  // Rows along both river banks, the avenues, and a park west of the tower.
  for (let x = -150; x <= 150; x += 7 + random() * 5) {
    spots.push([x, riverZ(x) - 13 - random() * 3]);
    if (random() < 0.7) spots.push([x + 3, riverZ(x) + 13 + random() * 6]);
  }
  for (let x = -68; x <= 68; x += 9) spots.push([x, -9.5], [x + 4, -71]);
  for (let i = 0; i < 40; i++) spots.push([-120 + random() * 40, -70 + random() * 60]);
  for (let i = 0; i < 50; i++) spots.push([80 + random() * 70, -90 + random() * 80]);
  for (let i = 0; i < 70; i++) {
    const x = -180 + random() * 360;
    const z = 50 + random() * 90;
    spots.push([x, z]);
  }
  // Keep the beaver and its dam in the open.
  const clear = spots.filter(([x, z]) => Math.hypot(x - 36, z - 17) > 11);
  spots.length = 0;
  spots.push(...clear);
  const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 1, 5);
  trunkGeo.translate(0, 0.5, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, flat(TONES.bark), spots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, flat(0xffffff), spots.length);
  const leafTones = [color("red"), color("orange"), TONES.gold, mix("red", "orange", 0.5), mix("brown", "orange", 0.5)];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  spots.forEach(([x, z], i) => {
    const s = 0.8 + random() * 0.6;
    const trunkH = 2.4 * s;
    m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, trunkH, s));
    trunks.setMatrixAt(i, m);
    q.setFromEuler(new THREE.Euler(random(), random() * 6, random()));
    m.compose(new THREE.Vector3(x, trunkH + 2 * s, z), q, new THREE.Vector3(3 * s, 2.6 * s, 3 * s));
    crowns.setMatrixAt(i, m);
    crowns.setColorAt(i, leafTones[Math.floor(random() * leafTones.length)]);
    q.identity();
  });
  crowns.castShadow = true;
  trunks.castShadow = true;
  const group = new THREE.Group();
  group.add(trunks, crowns);
  return group;
}

function buildDam(random) {
  const group = new THREE.Group();
  const log = new THREE.CylinderGeometry(0.45, 0.45, 1, 6);
  log.rotateX(Math.PI / 2);
  const mat = flat(TONES.bark);
  const x = 40;
  const z = riverZ(x);
  for (let i = 0; i < 26; i++) {
    const m = new THREE.Mesh(log, mat);
    const len = 4 + random() * 5;
    m.scale.set(1, 1, len);
    m.position.set(x + (random() - 0.5) * 2.5, -0.2 + (i % 4) * 0.55, z - 7 + (i / 26) * 14 + (random() - 0.5));
    m.rotation.y = 0.9 + (random() - 0.5) * 0.9;
    m.rotation.z = (random() - 0.5) * 0.3;
    m.castShadow = true;
    group.add(m);
  }
  return group;
}

function buildBeaver() {
  const g = new THREE.Group();
  const fur = flat(TONES.fur);
  const dark = flat(TONES.furDark);
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), fur);
  body.scale.set(1.25, 1, 1.8);
  body.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.72, 1), fur);
  head.position.set(0, 1.55, 1.75);
  const nose = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), dark);
  nose.position.set(0, 1.55, 2.45);
  const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.08), flat(color("cream")));
  teeth.position.set(0, 1.2, 2.3);
  const eyeGeo = new THREE.IcosahedronGeometry(0.09, 0);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 1.7), dark);
  tail.geometry.translate(0, 0, -0.85);
  tail.position.set(0, 0.35, -1.6);
  g.add(body, head, nose, teeth, tail);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, dark);
    eye.position.set(0.32 * s, 1.8, 2.3);
    const ear = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 0), dark);
    ear.position.set(0.5 * s, 2.15, 1.5);
    const paw = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), dark);
    paw.position.set(0.8 * s, 0.25, 0.9);
    g.add(eye, ear, paw);
  }
  g.traverse((o) => {
    o.castShadow = true;
  });
  // Sits on the north bank beside the dam, facing downstream toward the camera views.
  const x = 36;
  g.position.set(x, 0, riverZ(x) - 9.5);
  g.rotation.y = 0.35;
  g.scale.setScalar(2.2);
  return { group: g, head, tail };
}

function buildLeaves(count, random) {
  const shape = new THREE.BufferGeometry();
  shape.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0.5, 0.35, 0, 0, 0, 0, -0.5, -0.35, 0, 0], 3),
  );
  shape.setIndex([0, 1, 2, 0, 2, 3]);
  shape.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(shape, flat(0xffffff, { side: THREE.DoubleSide }), count);
  const tones = [color("red"), color("orange"), TONES.gold, color("brown")];
  const state = [];
  for (let i = 0; i < count; i++) {
    mesh.setColorAt(i, tones[i % tones.length]);
    state.push({
      p: new THREE.Vector3((random() - 0.5) * 160, random() * 50, (random() - 0.5) * 160),
      v: 1.2 + random() * 1.6,
      spin: new THREE.Vector3(random() * 3, random() * 3, random() * 3),
      r: new THREE.Euler(random() * 6, random() * 6, random() * 6),
      sway: random() * 6,
      s: 0.9 + random() * 0.9,
    });
  }
  return { mesh, state };
}

export function createCity(canvas, { reducedMotion }) {
  const random = rng(20260926);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = color("cream");
  scene.fog = new THREE.Fog(color("cream"), 140, 420);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 900);

  scene.add(new THREE.HemisphereLight(mix("cream", "orange", 0.15), TONES.bark, 1.6));
  // Low afternoon sun from the south-west, warm and long-shadowed.
  const sun = new THREE.DirectionalLight(mix("cream", "orange", 0.35), 2.4);
  sun.position.set(-90, 80, 110);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -130, right: 130, top: 130, bottom: -130, near: 10, far: 400 });
  sun.shadow.bias = -0.0008;
  scene.add(sun);

  scene.add(buildGround(random), buildRiver(), buildRoads(), buildTown(random), buildMaples(random), buildDam(random));
  const tower = buildTower();
  const beaver = buildBeaver();
  scene.add(tower.group, beaver.group);

  const leaves = buildLeaves(reducedMotion ? 0 : 420, random);
  scene.add(leaves.mesh);

  const target = { pos: new THREE.Vector3(...VIEWS.hero[0]), look: new THREE.Vector3(...VIEWS.hero[1]) };
  const look = target.look.clone();
  camera.position.copy(target.pos);

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  const clock = new THREE.Clock();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3();

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    if (reducedMotion) {
      camera.position.copy(target.pos);
      look.copy(target.look);
    } else {
      // Exponential ease toward the slide's view; about 1.5 s to settle.
      const k = 1 - Math.exp(-dt * 2.4);
      camera.position.lerp(target.pos, k);
      look.lerp(target.look, k);
      camera.position.y += Math.sin(t * 0.4) * 0.02;
      tower.flag.rotation.y = Math.sin(t * 2.2) * 0.25;
      beaver.tail.rotation.x = Math.max(0, Math.sin(t * 1.3)) * 0.35;
      beaver.head.rotation.x = Math.sin(t * 0.8) * 0.06;
      for (let i = 0; i < leaves.state.length; i++) {
        const L = leaves.state[i];
        L.p.y -= L.v * dt;
        L.p.x += Math.sin(t * 0.9 + L.sway) * dt * 1.4 + dt * 0.8;
        L.r.x += L.spin.x * dt;
        L.r.y += L.spin.y * dt;
        L.r.z += L.spin.z * dt;
        // Recycle each leaf above the current view so leaves always fall in frame.
        if (L.p.y < 0) {
          L.p.set(look.x + (random() - 0.5) * 160, 40 + random() * 20, look.z + (random() - 0.5) * 160);
        }
        q.setFromEuler(L.r);
        // A leaf that passes within 14 units of the lens would fill the frame, so it hides.
        const near = L.p.distanceToSquared(camera.position) < 196;
        m.compose(L.p, q, one.setScalar(near ? 0 : L.s));
        leaves.mesh.setMatrixAt(i, m);
      }
      leaves.mesh.instanceMatrix.needsUpdate = true;
    }
    camera.lookAt(look);
    renderer.render(scene, camera);
  }
  renderer.setAnimationLoop(frame);

  return {
    goTo(name) {
      const view = VIEWS[name] || VIEWS.hero;
      target.pos.set(...view[0]);
      target.look.set(...view[1]);
    },
  };
}
