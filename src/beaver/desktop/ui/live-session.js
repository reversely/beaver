// The live session (#61, #63). With the Cloudflare provider on, or on the Cloudflare page (#65),
// the Ask view shows the session page's link for other screens, and this page follows the
// session's agent over a WebSocket to show the notebook words whose review has fallen due.
import { getSession, review as saveReview } from "./backend.js";
const card = document.getElementById("session");
const qr = document.getElementById("session-qr");
const note = document.getElementById("session-note");
const link = document.getElementById("session-link");
const review = document.getElementById("review");
const reviewList = document.getElementById("review-list");
const NOTE = note.textContent;

let socket = null;
let socketUrl = null;
let retry = 1000;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function mark(word, remembered, item) {
  item.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    await saveReview(word.id, remembered);
  } catch {
    // On success the agent's next state removes the word; on failure the buttons come back.
    item.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
}

function wordItem(word) {
  const item = element("li", "review-word");
  const words = element("p", "review-words");
  const french = element("span", "review-fr", word.fr);
  french.lang = "fr";
  words.append(element("span", "review-en", word.en), french);
  if (word.visitor && word.visitor !== word.en) words.append(element("span", "review-visitor", word.visitor));
  item.append(words, element("p", "review-meaning", word.meaning));
  const actions = element("div", "review-actions");
  const remembered = element("button", "ask", "Remembered");
  const forgot = element("button", "review-forgot", "Forgot");
  remembered.type = forgot.type = "button";
  remembered.addEventListener("click", () => mark(word, true, item));
  forgot.addEventListener("click", () => mark(word, false, item));
  actions.append(remembered, forgot);
  item.append(actions);
  return item;
}

function showDue(words) {
  review.hidden = words.length === 0;
  reviewList.replaceChildren(...words.map(wordItem));
}

function follow(url) {
  if (url === socketUrl) return;
  socketUrl = url;
  socket?.close();
  socket = null;
  if (!url) {
    showDue([]);
    return;
  }
  const open = () => {
    if (socketUrl !== url) return;
    socket = new WebSocket(url);
    socket.addEventListener("open", () => (retry = 1000));
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type !== "cf_agent_state") return;
      showDue(message.state?.reviews_due ?? []);
      // app.js draws the turns of a Cloudflare voice call from the same state.
      document.dispatchEvent(new CustomEvent("session-state", { detail: message.state ?? {} }));
    });
    socket.addEventListener("close", () => {
      if (socketUrl !== url) return;
      setTimeout(open, retry);
      retry = Math.min(retry * 2, 30000);
    });
  };
  open();
}

async function refresh() {
  const state = await getSession().catch(() => null);
  follow(state?.socket ?? null);
  card.hidden = !state || (!state.link && !state.note);
  if (!state || card.hidden) return;
  note.textContent =
    state.note ?? (state.qr_svg ? NOTE : "Open this link on another screen to see each question and answer as it happens.");
  link.hidden = !state.link;
  // The laptop draws a QR code with segno; the Cloudflare page shows the link alone.
  qr.hidden = !state.qr_svg;
  if (state.qr_svg) {
    // The SVG is built by segno on this laptop from the configured Worker address.
    qr.innerHTML = state.qr_svg;
  }
  if (state.link) link.href = state.link;
}

document.addEventListener("settings", refresh);
