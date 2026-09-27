// The page background: a night over the Canadian Shield, drawn once as inline SVG.
//
// Depth palette (colour-theory skill): every plane mixes one aurora accent (#9ad38a) toward one
// near-black base (#07110f). The sky runs from 72% toward the base at the top to 88% at the
// horizon, the hills sit between those stops (78% far, 84% near) so they read against both, and
// the aurora is the one light source, at 10 to 30% toward white. The campfire is the only warm
// mark, small by design. Grain comes from an feTurbulence filter, which stipples the light the way
// the reference illustration does.

const P = {
  skyTop: "#304731",
  skyMid: "#243828",
  skyBottom: "#19281e",
  hillsFar: "#273c2a",
  hillsNear: "#1f3023",
  trees: "#16241b",
  lake: "#132119",
  shore: "#0d1914",
  focal: "#b8e0ad",
  glow: "#a4d796",
  fire: "#f08a3c",
  fireCore: "#ffd27a",
  log: "#5a3020",
};

function seeded(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const points = (list) => list.map(([x, y]) => `${x},${y}`).join(" ");

function stars(random) {
  let out = "";
  for (let i = 0; i < 70; i += 1) {
    const x = random() * 1600;
    const y = random() * 520;
    const r = 0.8 + random() * 1.6;
    out += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(1)}" fill="${P.focal}" opacity="${(0.25 + random() * 0.55).toFixed(2)}"/>`;
  }
  return out;
}

// Spruces along the near ridge: each is two stacked triangles, a low-poly silhouette.
function spruces(random) {
  let out = "";
  for (let x = -20; x < 1640; x += 18 + random() * 26) {
    const base = 752 + Math.sin(x / 140) * 18 + random() * 10;
    const h = 60 + random() * 70;
    const w = h * 0.34;
    out += `<polygon points="${points([[x, base - h], [x - w * 0.6, base - h * 0.45], [x + w * 0.6, base - h * 0.45]])}"/>`;
    out += `<polygon points="${points([[x, base - h * 0.62], [x - w, base], [x + w, base]])}"/>`;
  }
  return `<g fill="${P.trees}">${out}</g>`;
}

// Aurora curtains: jagged low-poly shards falling from the upper right, the scene's light.
const CURTAINS = [
  { opacity: 0.5, pts: [[880, -40], [990, -80], [1060, -10], [1140, -60], [1200, 40], [1020, 700], [800, 680]] },
  { opacity: 0.85, pts: [[1080, -30], [1190, -90], [1270, 0], [1360, -60], [1400, 90], [1210, 760], [1010, 740]] },
  { opacity: 0.45, pts: [[1300, -20], [1420, -70], [1510, 20], [1600, -30], [1600, 180], [1420, 700], [1260, 660]] },
];

function aurora() {
  const shards = CURTAINS.map(
    (c) => `<polygon points="${points(c.pts)}" fill="url(#curtain)" opacity="${c.opacity}"/>`,
  ).join("");
  return `
    <ellipse cx="1240" cy="220" rx="520" ry="330" fill="url(#halo)" filter="url(#grain)"/>
    <g class="aurora-drift">
      <g filter="url(#grain)">${shards}</g>
      <g opacity="0.35">${shards}</g>
    </g>`;
}

// Glowing motes drifting up toward the light.
function motes(random) {
  let out = "";
  for (let i = 0; i < 16; i += 1) {
    const x = 700 + random() * 850;
    const y = 520 + random() * 380;
    const delay = (random() * 9).toFixed(1);
    out += `<circle class="mote" cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(1.6 + random() * 2).toFixed(1)}" fill="${P.focal}" style="animation-delay:-${delay}s"/>`;
  }
  return out;
}

// A canoe with one paddler on the lake, in silhouette.
function canoe() {
  return `
    <g transform="translate(470 842)" fill="${P.shore}">
      <path d="M-70,0 Q0,16 70,0 L64,-6 Q0,6 -64,-6 Z"/>
      <polygon points="-6,-6 6,-6 3,-26 -3,-26"/>
      <circle cx="0" cy="-31" r="5"/>
      <polygon points="4,-20 40,10 37,12 1,-18"/>
    </g>`;
}

function campfire() {
  // On the shore at the left, small and warm: the one mark outside the green family.
  return `
    <g transform="translate(860 904)">
      <ellipse cx="0" cy="-10" rx="150" ry="90" fill="url(#fireglow)" filter="url(#grain)"/>
      <polygon points="-34,6 30,-8 34,0 -30,14" fill="${P.log}"/>
      <polygon points="-30,-8 34,8 30,16 -34,0" fill="${P.log}"/>
      <g class="flame">
        <polygon points="0,-78 16,-40 26,-18 12,2 -12,2 -24,-20 -12,-44" fill="${P.fire}"/>
        <polygon points="2,-52 12,-26 6,-2 -8,-2 -10,-24" fill="${P.fireCore}"/>
        <polygon points="18,-92 24,-80 16,-76" fill="${P.fire}" class="ember"/>
      </g>
    </g>`;
}

function scene() {
  const random = seeded(11);
  return `
<svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${P.skyTop}"/>
      <stop offset="0.35" stop-color="${P.skyMid}"/>
      <stop offset="0.62" stop-color="${P.skyBottom}"/>
      <stop offset="1" stop-color="${P.shore}"/>
    </linearGradient>
    <linearGradient id="curtain" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${P.focal}" stop-opacity="0"/>
      <stop offset="0.18" stop-color="#f4fbe9" stop-opacity="0.9"/>
      <stop offset="0.4" stop-color="${P.focal}"/>
      <stop offset="0.72" stop-color="${P.glow}" stop-opacity="0.45"/>
      <stop offset="1" stop-color="${P.glow}" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="halo">
      <stop offset="0" stop-color="${P.glow}" stop-opacity="0.45"/>
      <stop offset="0.5" stop-color="${P.glow}" stop-opacity="0.16"/>
      <stop offset="1" stop-color="${P.glow}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="fireglow">
      <stop offset="0" stop-color="${P.fire}" stop-opacity="0.5"/>
      <stop offset="0.45" stop-color="${P.fire}" stop-opacity="0.14"/>
      <stop offset="1" stop-color="${P.fire}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="reflection" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${P.glow}" stop-opacity="0.28"/>
      <stop offset="1" stop-color="${P.glow}" stop-opacity="0"/>
    </linearGradient>
    <!-- Grain: keep the shape only where fractal noise is dense, which stipples its edges. -->
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" result="noise"/>
      <feColorMatrix in="noise" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 2.2 -0.55" result="speck"/>
      <feComposite in="SourceGraphic" in2="speck" operator="in"/>
    </filter>
  </defs>
  <rect width="1600" height="1000" fill="url(#sky)"/>
  ${stars(random)}
  ${aurora()}
  <polygon fill="${P.hillsFar}" points="${points([[0, 700], [120, 640], [260, 668], [420, 610], [560, 650], [720, 600], [880, 640], [1040, 590], [1220, 632], [1380, 600], [1600, 646], [1600, 800], [0, 800]])}"/>
  <polygon fill="${P.hillsNear}" points="${points([[0, 760], [180, 716], [340, 742], [520, 700], [700, 736], [900, 704], [1100, 740], [1300, 708], [1480, 734], [1600, 716], [1600, 830], [0, 830]])}"/>
  ${spruces(random)}
  <rect y="800" width="1600" height="90" fill="${P.lake}"/>
  <polygon points="${points([[1080, 804], [1330, 804], [1270, 884], [1140, 884]])}" fill="url(#reflection)" filter="url(#grain)"/>
  <polygon fill="${P.shore}" points="${points([[0, 880], [240, 866], [520, 884], [820, 870], [1100, 890], [1380, 872], [1600, 884], [1600, 1000], [0, 1000]])}"/>
  ${canoe()}
  ${campfire()}
  ${motes(random)}
</svg>`;
}

const layer = document.createElement("div");
layer.className = "scene";
layer.setAttribute("aria-hidden", "true");
layer.innerHTML = scene();
document.body.prepend(layer);
