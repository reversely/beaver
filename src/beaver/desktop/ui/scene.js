// Beaver in the Ask view's header (#69): the model the home page shows (web/companion.js, drawn
// from the rover prototype's CAD model in web/beaver.js). He sways, turns when dragged, and moves
// his mouth with each answer's audio through speak(). Both servers publish the site's files at /,
// so the laptop app and the Cloudflare page load him from the same place.
const canvas = document.getElementById("scene");

// At desktop widths the canvas starts after the "Hey Beaver…" card instead of running under it
// (#20); phones keep the full-width canvas behind their smaller title.
const title = document.querySelector(".hero-title");
const DESKTOP = window.matchMedia("(min-width: 900px)");

function place() {
  const left = DESKTOP.matches && title ? title.offsetLeft + title.offsetWidth + 16 : 0;
  canvas.style.left = `${left}px`;
  canvas.style.width = `calc(100% - ${left}px)`;
}

let companion = null;
try {
  place();
  new ResizeObserver(place).observe(canvas.parentElement);
  const { createCompanion } = await import("/companion.js");
  companion = createCompanion(canvas);
} catch {
  // Without WebGL the header keeps its sky gradient and title.
  canvas.remove();
}

/** Play one answer clip, with Beaver's mouth following its loudness when he is on screen. */
export function speak(audio) {
  return companion ? companion.speak(audio) : audio.play();
}
