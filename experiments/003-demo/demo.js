import Reveal from "reveal";
import { createCity } from "./scene.js";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// The painted layers load in the background; slides work straight away and the scene joins in.
let city = { goTo() {} };
let currentView = "hello";
createCity(document.getElementById("city"), { reducedMotion }).then((c) => {
  city = c;
  city.goTo(currentView);
});

const stage = document.getElementById("stage");
const LANG_NAMES = { en: "English", fr: "Français", es: "Español" };
const LINK_ENDS = { pair: ["laptop", "rover"], session: ["rover", "phones"] };

// QR codes come from qrcode-generator (global `qrcode`), drawn as one SVG path.
function drawQr(el) {
  const qr = qrcode(0, "M");
  qr.addData(el.dataset.qr);
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
  }
  el.innerHTML = `<svg viewBox="0 0 ${n + 4} ${n + 4}" shape-rendering="crispEdges" aria-hidden="true"><rect width="100%" height="100%" fill="#fff"/><path d="${d}"/></svg>`;
}
document.querySelectorAll("[data-qr]").forEach(drawQr);

// Each setup screen plays a short scripted change once its slide is shown.
const timers = [];
function clearTimers() {
  timers.splice(0).forEach(clearTimeout);
}
const SCRIPTS = {
  pair() {
    const tag = document.querySelector('[data-status="pair"]');
    tag.textContent = "waiting";
    tag.classList.remove("ok");
    timers.push(setTimeout(() => {
      tag.textContent = "connected";
      tag.classList.add("ok");
    }, 2200));
  },
  deploy() {
    const bar = document.querySelector('[data-progress="deploy"]');
    const tag = document.querySelector('[data-status="deploy"]');
    bar.style.transition = "none";
    bar.style.width = "0%";
    tag.textContent = "deploying";
    tag.classList.remove("ok");
    timers.push(setTimeout(() => {
      bar.style.transition = reducedMotion ? "none" : "width 2s ease-out";
      bar.style.width = "100%";
    }, 400));
    timers.push(setTimeout(() => {
      tag.textContent = "deployed";
      tag.classList.add("ok");
    }, 2500));
  },
};

function showSlide(slide) {
  currentView = slide.dataset.view;
  city.goTo(currentView);
  clearTimers();
  const screen = slide.dataset.screen;
  stage.hidden = !screen;
  stage.classList.toggle("wide", slide.dataset.stage === "wide");
  if (screen) {
    document.querySelectorAll(".app-view").forEach((v) => v.classList.toggle("on", v.dataset.screen === screen));
    SCRIPTS[screen]?.();
  }
  document.querySelectorAll(".link").forEach((l) => l.classList.toggle("on", l.dataset.link === slide.dataset.link));
  const ends = LINK_ENDS[slide.dataset.link] || [];
  document.querySelectorAll(".node").forEach((n) => n.classList.toggle("on", ends.includes(n.dataset.node)));
}

// The recorded exchange from experiment 001, with its audio compressed to MP3.
async function loadSample() {
  const ex = await (await fetch("sample/exchange.json")).json();
  const bind = (key, text) => {
    document.querySelectorAll(`[data-bind="${key}"]`).forEach((el) => (el.textContent = text));
  };
  const date = new Date(`${ex.date}T12:00:00`).toLocaleDateString("en-CA", { day: "numeric", month: "long", year: "numeric" });
  bind("recorded", `Recorded ${date} in experiment 001 with ${ex.model}`);
  bind("question", ex.question);
  bind("timings", `Text ready ${(ex.timings_ms.text_ready / 1000).toFixed(1)} s, first audio ${(ex.timings_ms.first_audio_ready / 1000).toFixed(1)} s`);

  const groups = document.getElementById("groups");
  const lines = [];
  const byGroup = Map.groupBy(ex.sentences, (s) => s.group);
  for (const [g, sentences] of byGroup) {
    const li = document.createElement("li");
    for (const s of sentences) {
      const p = document.createElement("p");
      p.className = "line";
      p.lang = s.code;
      p.innerHTML = `<span class="code">${LANG_NAMES[s.code] || s.code}</span>`;
      p.append(document.createTextNode(s.text));
      li.append(p);
      lines.push({ el: p, src: `sample/g${g + 1}-${s.code}.mp3` });
    }
    groups.append(li);
  }

  const nb = ex.notebook;
  bind("nb-title", nb.title_en);
  bind("nb-title-fr", nb.title_fr);
  bind("nb-theme", nb.theme);
  const vocab = document.getElementById("vocab");
  for (const v of nb.vocabulary) {
    const tr = document.createElement("tr");
    for (const [cell, lang] of [[v.en, "en"], [v.fr, "fr"], [v.visitor, "es"], [v.meaning, "en"]]) {
      const td = document.createElement("td");
      td.lang = lang;
      td.textContent = cell;
      tr.append(td);
    }
    vocab.append(tr);
  }
  const concepts = document.getElementById("concepts");
  for (const c of nb.concepts) {
    const div = document.createElement("div");
    div.className = "concept";
    const h = document.createElement("h3");
    h.textContent = c.title;
    const p = document.createElement("p");
    p.textContent = `${c.summary} ${c.why_it_matters}`;
    div.append(h, p);
    concepts.append(div);
  }
  wirePlayback(lines);
}

// Plays each sentence in order and marks the one being spoken, as the desktop page does.
function wirePlayback(lines) {
  const button = document.getElementById("play-reply");
  let audio = null;
  let stopped = true;
  const stop = () => {
    stopped = true;
    audio?.pause();
    lines.forEach((x) => x.el.classList.remove("speaking"));
    lines[0]?.el.closest(".ask-turns").scrollTo({ top: 0 });
    button.textContent = "Play reply";
  };
  button.addEventListener("click", async () => {
    if (!stopped) return stop();
    stopped = false;
    button.textContent = "Stop";
    for (const line of lines) {
      if (stopped) return;
      line.el.classList.add("speaking");
      // Keep the spoken sentence in view inside the laptop screen without scrolling the page.
      const box = line.el.closest(".ask-turns");
      box.scrollTo({ top: line.el.offsetTop - box.offsetTop - 24, behavior: reducedMotion ? "auto" : "smooth" });
      audio = new Audio(line.src);
      await new Promise((done) => {
        audio.onended = done;
        audio.onerror = done;
        audio.play().catch(done);
      });
      line.el.classList.remove("speaking");
    }
    stop();
  });
  Reveal.on("slidechanged", stop);
}

// The intro greets the visitor in the languages of Beaver's likely visitors, one at a time.
const GREETINGS = [
  ["Hi", "English", "en"],
  ["Bonjour", "Français", "fr"],
  ["Hola", "Español", "es"],
  ["مرحبا", "العربية", "ar"],
  ["你好", "中文", "zh"],
  ["ਸਤ ਸ੍ਰੀ ਅਕਾਲ", "ਪੰਜਾਬੀ", "pa"],
  ["Kumusta", "Tagalog", "tl"],
  ["Kwe", "Anishinàbemowin", "alq"],
];
// Shrinks a .fit line until it fits its column on one line; long greetings such as Punjabi get
// smaller type, never a second line.
function fitLine(el) {
  el.style.fontSize = "";
  const room = el.parentElement.clientWidth;
  if (el.scrollWidth > room) {
    el.style.fontSize = `${(parseFloat(getComputedStyle(el).fontSize) * room) / el.scrollWidth}px`;
  }
}
const fitAll = () => document.querySelectorAll(".fit").forEach(fitLine);
window.addEventListener("resize", fitAll);
document.fonts.ready.then(fitAll);
fitAll();

function cycleGreetings() {
  const word = document.getElementById("greeting");
  const label = document.getElementById("greeting-lang");
  let i = 0;
  setInterval(() => {
    i = (i + 1) % GREETINGS.length;
    const [text, name, code] = GREETINGS[i];
    word.classList.remove("in");
    word.textContent = text;
    word.lang = code;
    word.dir = code === "ar" ? "rtl" : "ltr";
    label.textContent = name;
    fitLine(word);
    void word.offsetWidth;
    word.classList.add("in");
  }, 2200);
}
if (!reducedMotion) cycleGreetings();

await Reveal.initialize({
  view: "scroll",
  scrollProgress: true,
  scrollSnap: "mandatory",
  scrollActivationWidth: null,
  hash: true,
  controls: false,
  progress: false,
  center: false,
  disableLayout: true,
  transition: "none",
});
Reveal.on("slidechanged", (e) => showSlide(e.currentSlide));
showSlide(Reveal.getCurrentSlide());
loadSample();

// Autoplay advances one slide every 8 s and loops, for an unattended laptop.
const autoplay = document.getElementById("autoplay");
let autoTimer = null;
function setAutoplay(on) {
  clearInterval(autoTimer);
  autoTimer = on ? setInterval(() => (Reveal.isLastSlide() ? Reveal.slide(0) : Reveal.next()), 8000) : null;
  autoplay.setAttribute("aria-pressed", String(on));
  autoplay.textContent = on ? "Pause demo" : "Play demo";
}
autoplay.addEventListener("click", () => setAutoplay(!autoTimer));
document.getElementById("restart").addEventListener("click", () => Reveal.slide(0));
