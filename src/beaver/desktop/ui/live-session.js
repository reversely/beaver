// The live session card (#61): with the Cloudflare provider on, another screen can follow this
// conversation through the session page the beaver-agent Worker serves.
const card = document.getElementById("session");
const qr = document.getElementById("session-qr");
const note = document.getElementById("session-note");
const link = document.getElementById("session-link");
const NOTE = note.textContent;

async function refresh() {
  const state = await fetch("/api/session").then((r) => r.json()).catch(() => null);
  card.hidden = !state || (!state.link && !state.note);
  if (!state || card.hidden) return;
  note.textContent = state.note ?? NOTE;
  link.hidden = !state.link;
  qr.hidden = !state.link;
  if (state.link) {
    // The SVG is built by segno on this laptop from the configured Worker address.
    qr.innerHTML = state.qr_svg;
    link.href = state.link;
  }
}

document.addEventListener("settings", refresh);
