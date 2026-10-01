// The live session viewer (#61). It opens a read-only WebSocket to the session's agent and
// redraws the turns each time the agent sends its state. Turn text is set with textContent, so
// nothing a turn holds can run as HTML.
const params = new URLSearchParams(location.search);
const session = params.get("s") ?? "";
const key = params.get("key") ?? "";
const statusLine = document.getElementById("status");
const list = document.getElementById("turns");
const empty = document.getElementById("empty");
const due = document.getElementById("due");
const dueList = document.getElementById("due-list");

function setStatus(text, isError = false) {
  statusLine.textContent = text;
  statusLine.classList.toggle("error", isError);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function turnItem(turn) {
  const item = element("li", "turn");
  const question = element("p", "question", turn.question);
  // dir="auto" sets each line's direction from its own text, so Arabic reads right to left.
  question.dir = "auto";
  item.append(question);
  const groups = new Map();
  for (const sentence of turn.sentences) {
    if (!groups.has(sentence.group)) groups.set(sentence.group, []);
    groups.get(sentence.group).push(sentence);
  }
  for (const sentences of groups.values()) {
    const group = element("div", "group");
    for (const sentence of sentences) {
      const line = element("p", "line");
      line.lang = sentence.code;
      const text = element("span", "text", sentence.text);
      text.dir = "auto";
      line.append(element("span", "code", sentence.code), text);
      group.append(line);
    }
    item.append(group);
  }
  return item;
}

// Words whose review has fallen due (#63). The laptop marks them; this page only lists them.
function dueItem(word) {
  const item = element("li", "due-word");
  const french = element("span", "due-fr", word.fr);
  french.lang = "fr";
  item.append(element("span", "due-en", word.en), french, element("span", "due-meaning", word.meaning));
  return item;
}

export function render(state) {
  const words = state?.reviews_due ?? [];
  due.hidden = words.length === 0;
  dueList.replaceChildren(...words.map(dueItem));
  const turns = state?.turns ?? [];
  empty.hidden = turns.length > 0;
  list.replaceChildren(...turns.slice().reverse().map(turnItem));
}

let retry = 1000;

function connect() {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const path = `/agents/beaver-guide/${encodeURIComponent(session)}`;
  const socket = new WebSocket(`${scheme}://${location.host}${path}?key=${encodeURIComponent(key)}`);
  socket.addEventListener("open", () => {
    retry = 1000;
    setStatus("Live");
  });
  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === "cf_agent_state") render(message.state);
  });
  socket.addEventListener("close", (event) => {
    // The Worker answers a wrong key before the upgrade, which closes with no clean code.
    setStatus(`Reconnecting in ${retry / 1000} s`, !event.wasClean);
    setTimeout(connect, retry);
    retry = Math.min(retry * 2, 30000);
  });
}

if (!session || !key) setStatus("This link is missing its session or key.", true);
else connect();
