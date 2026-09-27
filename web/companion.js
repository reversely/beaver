// Beaver on the home page (#48): the model from beaver.js, drawn in a fixed corner on every slide.
// Beaver sways slowly through 180 degrees and wags his tail, his mouth follows his clips, a drag on his
// head aims it, and a drag anywhere else turns him. With reduced motion he stays still and the
// canvas redraws only on a mouth change or a drag.
import * as THREE from "three";
import { attachHeadDrag, createBeaver, speakWith } from "./beaver.js";

export function createCompanion(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  // The same lights as the model's preview, web/beaver.html.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 2.25));
  const sun = new THREE.DirectionalLight(0xffffff, 2.75);
  sun.position.set(4, 6, 5);
  scene.add(sun);

  const beaver = createBeaver();
  scene.add(beaver);
  // Beaver faces +x; a three-quarter view from the front right shows the face, the body behind it,
  // and the tail.
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
  camera.position.set(6.4, 1.9, 4.6);
  camera.lookAt(0.1, 0.8, 0);

  let queued = false;
  function draw() {
    queued = false;
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }
  function redraw() {
    if (!queued) {
      queued = true;
      requestAnimationFrame(draw);
    }
  }
  const show = beaver.userData.mouth;
  beaver.userData.mouth = (openness) => {
    show(openness);
    redraw();
  };
  new ResizeObserver(redraw).observe(canvas);

  // A slow sway, 90 degrees either side of facing the camera, one full sway every 16 seconds;
  // paused while dragged and for a moment after, then it carries on from wherever he was left.
  const SWAY = Math.PI / 2;
  const SWAY_SPEED = (Math.PI * 2) / 16;
  // Beaver faces +x; this turn points his face at the camera.
  beaver.rotation.y = -Math.atan2(camera.position.z, camera.position.x);
  let phase = 0;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let last = null;
  let resumeAt = 0;
  function spin(now) {
    if (last !== null && now >= resumeAt && dragX === null && body.enabled) {
      const step = (SWAY_SPEED * (now - last)) / 1000;
      beaver.rotation.y += SWAY * (Math.sin(phase + step) - Math.sin(phase));
      phase += step;
    }
    if (last !== null) {
      beaver.userData.update(now / 1000);
      draw();
    }
    last = now;
    requestAnimationFrame(spin);
  }
  if (!still) requestAnimationFrame(spin);

  // A drag that starts on the head aims the head (beaver.js) and switches the body turn off.
  const body = { enabled: true };
  attachHeadDrag({ beaver, camera, element: canvas, controls: body });

  // Dragging anywhere else turns Beaver around his vertical axis.
  let dragX = null;
  canvas.addEventListener("pointermove", () => {
    if (!body.enabled) redraw();
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (!body.enabled) return;
    dragX = event.clientX;
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("is-turning");
  });
  canvas.addEventListener("pointermove", (event) => {
    if (dragX === null) return;
    beaver.rotation.y += (event.clientX - dragX) * 0.012;
    dragX = event.clientX;
    redraw();
  });
  const release = () => {
    dragX = null;
    resumeAt = performance.now() + 1500;
    canvas.classList.remove("is-turning");
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  redraw();

  // Plays one of Beaver's clips with the mouth following its loudness.
  return { speak: (audio) => speakWith(beaver, audio) };
}
