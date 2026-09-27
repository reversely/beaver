// Painted Ottawa behind the slides. The layers cut from one painting (art/build_layers.py) sit on
// flat planes at different depths, and a perspective camera glides between views, so nearer
// layers slide past faster than far ones. Nothing is lit or modelled: every pixel is painted.
import * as THREE from "three";

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
  "newcomer-1": [2.5, 3, -2],
  "newcomer-2": [3.5, 3.4, -4],
  "newcomer-3": [4.5, 3.6, -6],
  "newcomer-4": [3, 2.4, -1],
  "beaver-1": [5.5, 4.4, -8],
  "beaver-2": [4.5, 3.6, -5],
  "beaver-3": [3.5, 2.6, -2],
  hey: [-6, -1.6, -3],
  site: [-4, 2.5, -6],
  deploy: [6, 1.5, -6],
  conversation: [-7.5, -2.5, -5],
  notebook: [-10, -1, -3],
  close: [2, 1, -2],
};
// Slides where the maple branches frame the view.
const FRAMED = new Set(["hello", "close"]);

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
    goTo(name) {
      viewName = name;
      aim();
      framedTarget = FRAMED.has(name) ? 1 : 0;
    },
  };
}
