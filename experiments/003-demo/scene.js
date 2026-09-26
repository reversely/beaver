// Painted Ottawa behind the slides. The layers cut from one painting (art/build_layers.py) sit on
// flat planes at different depths, and a perspective camera glides between views, so nearer
// layers slide past faster than far ones. Nothing is lit or modelled: every pixel is painted.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";

// Each plane is scaled by its depth, so from the base camera at the origin all layers line up
// as the original painting.
const BASE_DEPTH = 30;
const LAND_HEIGHT = 22;
const LAYERS = [
  { src: "art/clouds.webp", depth: 44 },
  { src: "art/land.webp", depth: 30 },
  { src: "art/parliament.webp", depth: 28.4 },
];

// Camera position per slide. The camera always looks straight ahead (-z), so every move is a
// pan or a push-in and the painting never skews.
const VIEWS = {
  hello: [4.5, 4.6, -6],
  newcomer: [0, 0.4, 1.5],
  hey: [-6, -1.6, -3],
  signin: [-8, 0.5, -4],
  site: [-4, 2.5, -6],
  pair: [3, 3.5, -10],
  deploy: [6, 1.5, -6],
  session: [-2, -2, -4],
  conversation: [-7.5, -2.5, -5],
  notebook: [-10, -1, -3],
  close: [2, 1, -2],
};
// Slides where the maple branches frame the view.
const FRAMED = new Set(["hello", "newcomer", "close"]);

// Beaver's head: the rover's printed head shell (art/head.glb, millimetres), riding with the
// camera like a foreground character. Pose per slide: position in camera space, turn (yaw, in
// radians; positive turns toward the viewer's right), and size (scene units per millimetre).
// Slides without a pose hide the head.
const HEAD_POSES = {
  hello: { pos: [1.9, -0.45, -6], yaw: -0.5, size: 0.026 },
  pair: { pos: [-1.55, -1.05, -6], yaw: 0.8, size: 0.015 },
  close: { pos: [1.9, -0.45, -6], yaw: -0.5, size: 0.026 },
};
// Hole positions on the face, in millimetres, measured by casting rays through the shell.
const EYES = { y: 15.5, w: 26, h: 12 };
const MOUTH = { y: -16, w: 24, h: 15 };

// Multiplied over the orange leaf sprite for a spread of autumn colours.
const LEAF_TINTS = ["#ffffff", "#f2a37c", "#e0604a", "#f5c26b"];

function loadTexture(loader, src) {
  return new Promise((resolve, reject) => {
    loader.load(src, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      resolve(t);
    }, undefined, reject);
  });
}

function paintedPlane(texture, depth) {
  const h = LAND_HEIGHT * (depth / BASE_DEPTH);
  const w = h * (texture.image.width / texture.image.height);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  mesh.position.z = -depth;
  return mesh;
}

// The head is the one lit object: a soft warm key from the upper left, a sky fill, and a rim,
// all riding with the camera so the lighting stays the same on every slide.
async function buildHead(camera) {
  const gltf = await new GLTFLoader().loadAsync("art/head.glb");
  let geometry;
  gltf.scene.traverse((o) => {
    if (o.isMesh) geometry = o.geometry;
  });
  // Crisp edges on the shell's corners, smooth shading across its fillets.
  geometry = toCreasedNormals(geometry, THREE.MathUtils.degToRad(35));
  const shell = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: "#c98a5a", roughness: 0.78 }));

  // Warm panels inside the hollow shell show through the eye and mouth holes.
  const glow = (spec, colour) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(spec.w, spec.h), new THREE.MeshBasicMaterial({ color: colour }));
    m.position.set(0, spec.y, 8);
    return m;
  };
  const eyes = glow(EYES, "#ffe2b0");
  const mouth = glow(MOUTH, "#5a2c16");

  const model = new THREE.Group();
  model.add(shell, eyes, mouth);
  const rig = new THREE.Group();
  rig.add(model);
  rig.scale.setScalar(0.0001);
  camera.add(rig);

  const hemi = new THREE.HemisphereLight("#fff1dc", "#8a5236", 1.9);
  const key = new THREE.DirectionalLight("#fff0da", 3);
  key.position.set(-3, 4, 2);
  const rim = new THREE.DirectionalLight("#ffb27a", 1.6);
  rim.position.set(4, 2, -6);
  camera.add(hemi, key, rim);

  const quiet = new THREE.Color("#5a2c16");
  const lit = new THREE.Color("#ffc98a");
  let pose = null;
  let talking = 0;
  let talkingTarget = 0;
  let blinkAt = 3;
  const goal = { pos: new THREE.Vector3(0, -1, -6), yaw: 0, size: 0.0001 };

  return {
    pose(name) {
      pose = HEAD_POSES[name] || null;
      if (pose) {
        goal.pos.set(...pose.pos);
        goal.yaw = pose.yaw;
        goal.size = pose.size;
      } else {
        goal.size = 0.0001;
      }
    },
    talk(on) {
      talkingTarget = on ? 1 : 0;
    },
    update(dt, t, still) {
      const k = still ? 1 : 1 - Math.exp(-dt * 3);
      rig.position.lerp(goal.pos, k);
      rig.rotation.y += (goal.yaw - rig.rotation.y) * k;
      rig.scale.setScalar(rig.scale.x + (goal.size - rig.scale.x) * k);
      rig.visible = rig.scale.x > 0.001;
      if (still) return;
      // Idle: a slow bob and a small look around.
      model.position.y = Math.sin(t * 1.1) * 1.2;
      model.rotation.y = Math.sin(t * 0.45) * 0.08;
      model.rotation.x = Math.sin(t * 0.7) * 0.03;
      // The mouth glows while Beaver speaks, flickering like a voice meter.
      talking += (talkingTarget - talking) * (1 - Math.exp(-dt * 10));
      const voice = talking * (0.55 + 0.45 * Math.abs(Math.sin(t * 13) * Math.sin(t * 5.3)));
      mouth.material.color.copy(quiet).lerp(lit, voice);
      // A blink every few seconds.
      blinkAt -= dt;
      eyes.scale.y = blinkAt < 0.12 && blinkAt > 0 ? 0.1 : 1;
      if (blinkAt <= 0) blinkAt = 3 + Math.random() * 3;
    },
  };
}

export async function createCity(canvas, { reducedMotion }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
  scene.add(camera);

  const loader = new THREE.TextureLoader();
  const [clouds, land, parliament, branches, leaf] = await Promise.all(
    [...LAYERS.map((l) => l.src), "art/foreground.webp", "art/leaf-2.webp"].map((s) => loadTexture(loader, s)),
  );
  const planes = [clouds, land, parliament].map((tex, i) => {
    const p = paintedPlane(tex, LAYERS[i].depth);
    p.renderOrder = i;
    scene.add(p);
    return p;
  });
  const cloudPlane = planes[0];

  // Branches ride with the camera, just in front of it, and fade in on the framed slides.
  const branchMat = new THREE.MeshBasicMaterial({ map: branches, transparent: true, depthWrite: false });
  const branchPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), branchMat);
  branchPlane.renderOrder = 20;
  branchPlane.position.z = -4;
  camera.add(branchPlane);

  const head = await buildHead(camera);

  const target = new THREE.Vector3(...VIEWS.hello);
  camera.position.copy(target);

  // Falling leaves: a few painted sprites drifting down between the layers.
  const leaves = [];
  const leafGeo = new THREE.PlaneGeometry(0.55, 0.55);
  function respawn(L, anywhere) {
    const depth = 8 + Math.random() * 16;
    const half = depth * 0.5;
    L.m.position.set(
      camera.position.x + (Math.random() - 0.5) * 2 * half,
      camera.position.y + (anywhere ? (Math.random() - 0.5) * half : half * 0.45),
      camera.position.z - depth,
    );
    L.size = 0.7 + Math.random() * 0.8;
  }
  for (let i = 0; i < (reducedMotion ? 0 : 22); i++) {
    const m = new THREE.Mesh(
      leafGeo,
      new THREE.MeshBasicMaterial({
        map: leaf,
        color: LEAF_TINTS[i % LEAF_TINTS.length],
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    m.renderOrder = 10;
    const L = { m, speed: 0.35 + Math.random() * 0.4, sway: Math.random() * 6, spin: 0.4 + Math.random() * 0.8 };
    respawn(L, true);
    scene.add(m);
    leaves.push(L);
  }

  let framed = 1;
  let framedTarget = 1;

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // The branch plane covers the viewport at its distance, cropped to keep its aspect.
    const vh = 2 * Math.abs(branchPlane.position.z) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const vw = vh * camera.aspect;
    const imgAspect = branches.image.width / branches.image.height;
    const cover = Math.max(vw / imgAspect, vh);
    branchPlane.scale.set(cover * imgAspect, cover, 1);
  }
  window.addEventListener("resize", resize);
  resize();

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    if (reducedMotion) {
      camera.position.copy(target);
      framed = framedTarget;
    } else {
      // Exponential ease toward the slide's view; about 1.6 s to settle.
      const k = 1 - Math.exp(-dt * 2.2);
      camera.position.lerp(target, k);
      framed += (framedTarget - framed) * k;
      cloudPlane.position.x = Math.sin(t * 0.03) * 2;
      branchPlane.rotation.z = Math.sin(t * 0.6) * 0.006;
      for (const L of leaves) {
        L.m.position.y -= L.speed * dt;
        L.m.position.x += Math.sin(t * 0.8 + L.sway) * dt * 0.35;
        L.m.rotation.z += L.spin * dt;
        // A flutter: the leaf turns edge-on and back as it falls.
        L.m.scale.set(L.size * Math.cos(t * 1.6 + L.sway), L.size, 1);
        if (L.m.position.y < camera.position.y - 8) respawn(L, false);
      }
    }
    head.update(dt, t, reducedMotion);
    branchMat.opacity = framed;
    branchPlane.visible = framed > 0.01;
    renderer.render(scene, camera);
  });

  // Keep the view inside the land painting: the visible half-size at the land's distance must
  // fit inside the plane, whatever the window's aspect ratio.
  const landW = planes[1].geometry.parameters.width;
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  let viewName = "hello";
  function aim() {
    const [x, y, z] = VIEWS[viewName] || VIEWS.hello;
    const halfH = (BASE_DEPTH + z) * tanHalf;
    const maxX = Math.max(0, landW / 2 - halfH * camera.aspect);
    const maxY = Math.max(0, LAND_HEIGHT / 2 - halfH);
    target.set(THREE.MathUtils.clamp(x, -maxX, maxX), THREE.MathUtils.clamp(y, -maxY, maxY), z);
  }
  window.addEventListener("resize", aim);

  return {
    talk: (on) => head.talk(on),
    goTo(name) {
      viewName = name;
      aim();
      head.pose(name);
      framedTarget = FRAMED.has(name) ? 1 : 0;
    },
  };
}
