// Notebook list in the sidebar and the notebook view. All notebook text is model output, so it
// is set with textContent and never parsed as HTML.
import { artifactImage, pieceFor } from "./artifacts.js";

const list = document.getElementById("notebook-list");
const emptyNote = document.getElementById("notebooks-empty");
const conversationView = document.getElementById("conversation-view");
const notebookView = document.getElementById("notebook-view");
const conversationButton = document.getElementById("nav-conversation");
const LANGUAGE_NAMES = new Intl.DisplayNames(["en"], { type: "language" });

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function span(start, end) {
  return start === end ? String(start) : `${start}–${end}`;
}

function setActive(button) {
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("is-active", b === button));
}

export function showConversation() {
  if (location.hash) history.replaceState(null, "", location.pathname);
  notebookView.hidden = true;
  conversationView.hidden = false;
  setActive(conversationButton);
}
conversationButton.addEventListener("click", showConversation);

export async function refreshNotebooks() {
  const notebooks = await (await fetch("/api/notebooks")).json();
  list.replaceChildren();
  emptyNote.hidden = notebooks.length > 0;
  for (const notebook of notebooks) {
    const item = el("li");
    const button = el("button", "nav-item notebook-item");
    button.type = "button";
    button.dataset.id = notebook.id;
    const image = el("img", "notebook-thumb");
    image.alt = "";
    image.src = artifactImage(pieceFor(notebook));
    const text = el("span", "notebook-item-text");
    text.append(el("span", "notebook-item-title", notebook.title_en));
    const meta = el("span", "notebook-item-meta");
    meta.append(el("span", null, span(notebook.year_start, notebook.year_end)), el("span", null, `${notebook.entries} ${notebook.entries === 1 ? "question" : "questions"}`));
    text.append(meta);
    button.append(image, text);
    button.addEventListener("click", () => openNotebook(notebook.id));
    item.append(button);
    list.append(item);
  }
}

export async function openNotebook(id) {
  const response = await fetch(`/api/notebooks/${encodeURIComponent(id)}`);
  if (!response.ok) return;
  const notebook = await response.json();
  history.replaceState(null, "", `#notebook=${encodeURIComponent(id)}`);
  setActive(list.querySelector(`[data-id="${CSS.escape(id)}"]`));
  conversationView.hidden = true;
  notebookView.hidden = false;
  notebookView.replaceChildren(header(notebook), timeline(notebook), vocabulary(notebook), concepts(notebook), questions(notebook));
  notebookView.scrollIntoView({ block: "start" });
}

function header(notebook) {
  const head = el("header", "nb-head");
  const image = el("img", "nb-artifact");
  image.alt = "";
  image.src = artifactImage(pieceFor(notebook));
  const titles = el("div", "nb-titles");
  titles.append(el("h1", "nb-title", notebook.title_en));
  const french = el("p", "nb-title-fr", notebook.title_fr);
  french.lang = "fr";
  titles.append(french);
  const tags = el("div", "turn-meta");
  tags.append(
    el("span", "tag", notebook.theme),
    el("span", "tag", span(notebook.year_start, notebook.year_end)),
    el("span", "tag", `${notebook.entries.length} ${notebook.entries.length === 1 ? "question" : "questions"}`),
  );
  titles.append(tags);
  head.append(image, titles);
  return head;
}

function section(title) {
  const node = el("section", "nb-section");
  node.append(el("h2", "nb-heading", title));
  return node;
}

function timeline(notebook) {
  const node = section("Timeline");
  const seen = new Set();
  const moments = notebook.entries
    .flatMap((entry) => entry.moments)
    .filter((m) => {
      const key = `${m.year}|${m.event.toLowerCase()}`;
      return seen.has(key) ? false : seen.add(key);
    })
    .sort((a, b) => a.year - b.year);
  if (!moments.length) {
    node.append(el("p", "empty", "No dated moments yet"));
    return node;
  }
  const rail = el("ol", "timeline");
  for (const moment of moments) {
    const item = el("li", "timeline-item");
    item.append(el("span", "timeline-year", String(moment.year)), el("span", "timeline-event", moment.event));
    rail.append(item);
  }
  node.append(rail);
  return node;
}

function vocabulary(notebook) {
  const node = section("Vocabulary");
  const grid = el("div", "vocab-grid");
  for (const entry of notebook.entries) {
    const visitorCode = entry.visitor_language.code;
    for (const word of entry.vocabulary) {
      const faces = [["en", word.en], ["fr", word.fr]];
      if (!["en", "fr"].includes(visitorCode)) faces.push([visitorCode, word.visitor]);
      grid.append(vocabCard(faces, word.meaning));
    }
  }
  if (!grid.children.length) {
    node.append(el("p", "empty", "No vocabulary yet"));
    return node;
  }
  node.append(el("p", "hint", "Click a card to switch language"), grid);
  return node;
}

function vocabCard(faces, meaning) {
  const card = el("button", "vocab-card");
  card.type = "button";
  const language = el("span", "tag");
  const word = el("span", "vocab-word");
  word.dir = "auto";
  let index = 0;
  const show = () => {
    const [code, text] = faces[index];
    language.textContent = LANGUAGE_NAMES.of(code) ?? code;
    word.textContent = text;
    word.lang = code;
  };
  show();
  card.addEventListener("click", () => {
    index = (index + 1) % faces.length;
    show();
  });
  card.append(language, word, el("span", "vocab-meaning", meaning));
  return card;
}

function concepts(notebook) {
  const node = section("Concepts");
  const items = notebook.entries.flatMap((entry) => entry.concepts);
  if (!items.length) {
    node.append(el("p", "empty", "No concepts yet"));
    return node;
  }
  const grid = el("div", "concept-grid");
  for (const concept of items) {
    const card = el("article", "concept-card");
    card.append(el("h3", "concept-title", concept.title), el("p", "concept-summary", concept.summary));
    const why = el("p", "concept-why");
    why.append(el("span", "concept-why-label", "Why it matters"), el("span", null, concept.why_it_matters));
    card.append(why);
    grid.append(card);
  }
  node.append(grid);
  return node;
}

function questions(notebook) {
  const node = section("Questions");
  const items = el("ul", "question-list");
  for (const entry of notebook.entries) {
    const item = el("li", "question-item");
    const question = el("p", "question-text", entry.question);
    question.dir = "auto";
    question.lang = entry.visitor_language.code;
    item.append(question, el("p", "question-answer", entry.answer));
    if (entry.source === "rover") item.append(el("span", "tag question-source", "rover"));
    items.append(item);
  }
  node.append(items);
  return node;
}

// A #notebook=<id> link opens that notebook on load.
const linked = new URLSearchParams(location.hash.slice(1)).get("notebook");
refreshNotebooks().then(() => linked && openNotebook(linked));
