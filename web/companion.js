// Beaver on the home page (#48): the model from beaver.js, drawn in a fixed corner on every slide.
// Beaver moves only when a clip plays (the mouth) or when the visitor drags to turn him, so the
// canvas redraws only then.
import * as THREE from "three";
import { createBeaver, speakWith } from "./beaver.js";

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

  // Dragging turns Beaver around his vertical axis.
  let dragX = null;
  canvas.addEventListener("pointerdown", (event) => {
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
    canvas.classList.remove("is-turning");
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  redraw();

  // Plays one of Beaver's clips with the mouth following its loudness.
  return { speak: (audio) => speakWith(beaver, audio) };
}
