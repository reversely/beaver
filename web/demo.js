import Reveal from "reveal";
import { createCity } from "./scene.js";
import { createSound } from "./sound.js";
import { setupStory, storyStep } from "./story.js";
import { createCompanion } from "./companion.js";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// The painted layers load in the background; slides work straight away and the scene joins in.
let city = { goTo() {} };
let currentView = "hello";
createCity(document.getElementById("city"), { reducedMotion }).then((c) => {
  city = c;
  city.goTo(currentView);
});

const companion = createCompanion(document.getElementById("companion"));
const sound = createSound({ voice: companion.speak });
setupStory(sound);

const stage = document.getElementById("stage");
const phoneStage = document.getElementById("phone-stage");
const LANG_NAMES = { en: "English", fr: "Français", es: "Español" };
// The app's sidebar topic that each laptop screen belongs to.
const SCREEN_TOPICS = { duties: "duties", documents: "documents", conversation: "ask", notebook: "notebooks", rover: "rover" };

function showSlide(slide) {
  sound.stop();
  // A story page's view follows its current line; any other page has one view.
  currentView = storyStep(slide) || slide.dataset.view;
  city.goTo(currentView);
  const screen = slide.dataset.screen;
  stage.hidden = !screen;
  const phone = slide.dataset.phone;
  phoneStage.hidden = !phone;
  document.querySelectorAll(".phone-view").forEach((v) => v.classList.toggle("on", v.dataset.phone === phone));
  document.body.dataset.companion = screen || phone ? "corner" : "open";
  stage.classList.toggle("wide", slide.dataset.stage === "wide");
  if (screen) {
    document.querySelectorAll(".app-view").forEach((v) => v.classList.toggle("on", v.dataset.screen === screen));
    document.querySelector(".laptop .app").dataset.topic = SCREEN_TOPICS[screen];
  }
}

// A recorded desktop-app exchange, with its audio compressed to MP3.
async function loadSample() {
  const ex = await (await fetch("sample/exchange.json")).json();
  const bind = (key, text) => {
    document.querySelectorAll(`[data-bind="${key}"]`).forEach((el) => (el.textContent = text));
  };
  const date = new Date(`${ex.date}T12:00:00`).toLocaleDateString("en-CA", { day: "numeric", month: "long", year: "numeric" });
  bind("recorded", `Recorded ${date} on the desktop app with ${ex.model}`);
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
        companion.speak(audio).catch(done);
      });
      line.el.classList.remove("speaking");
    }
    stop();
  });
  Reveal.on("slidechanged", stop);
}

// Beaver introduces itself in the languages of its likely visitors, one sentence at a time.
// The product name stays in Latin letters in every language.
const GREETINGS = [
  ["Hi, I'm Beaver", "en"],
  ["Bonjour, je suis Beaver", "fr"],
  ["Hola, soy Beaver", "es"],
  ["مرحبًا، أنا Beaver", "ar"],
  ["你好，我是 Beaver", "zh"],
  ["ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਮੈਂ Beaver ਹਾਂ", "pa"],
  ["Kumusta, ako si Beaver", "tl"],
  ["Привіт, я Beaver", "uk"],
];

// Shrinks a .fit line until it fits its column on one line.
function fitLine(el) {
  el.style.fontSize = "";
  const room = el.parentElement.clientWidth;
  if (el.scrollWidth > room) {
    el.style.fontSize = `${(parseFloat(getComputedStyle(el).fontSize) * room) / el.scrollWidth}px`;
  }
}
// One size for every greeting, set by the longest, so the type does not jump as languages change.
function fitGreeting() {
  const el = document.getElementById("greeting");
  el.style.fontSize = "";
  const base = parseFloat(getComputedStyle(el).fontSize);
  const room = el.parentElement.clientWidth;
  const probe = el.cloneNode();
  Object.assign(probe.style, { position: "absolute", visibility: "hidden", width: "auto" });
  el.parentElement.append(probe);
  let widest = 0;
  for (const [text, code] of GREETINGS) {
    probe.textContent = text;
    probe.lang = code;
    widest = Math.max(widest, probe.scrollWidth);
  }
  probe.remove();
  el.style.fontSize = `${Math.min(base, (base * room) / widest)}px`;
}
const fitAll = () => {
  document.querySelectorAll(".fit").forEach(fitLine);
  fitGreeting();
};
window.addEventListener("resize", fitAll);
document.fonts.ready.then(fitAll);
fitAll();

function cycleGreetings() {
  const el = document.getElementById("greeting");
  let i = 0;
  setInterval(() => {
    i = (i + 1) % GREETINGS.length;
    const [text, code] = GREETINGS[i];
    el.classList.remove("in");
    el.textContent = text;
    el.lang = code;
    el.dir = code === "ar" ? "rtl" : "ltr";
    void el.offsetWidth;
    el.classList.add("in");
  }, 2600);
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
// Revealing or hiding a story line is a step within the page, not a new page.
Reveal.on("fragmentshown", () => showSlide(Reveal.getCurrentSlide()));
Reveal.on("fragmenthidden", () => showSlide(Reveal.getCurrentSlide()));
showSlide(Reveal.getCurrentSlide());
loadSample();

// Autoplay takes one step every 8 s (a page, or the next line of a story page) and loops, for an
// unattended laptop.
const autoplay = document.getElementById("autoplay");
let autoTimer = null;
function setAutoplay(on) {
  clearInterval(autoTimer);
  autoTimer = on ? setInterval(() => (Reveal.isLastSlide() ? Reveal.slide(0) : Reveal.next()), 8000) : null;
  autoplay.setAttribute("aria-pressed", String(on));
  autoplay.textContent = on ? "Pause" : "Play";
}
autoplay.addEventListener("click", () => setAutoplay(!autoTimer));
document.getElementById("restart").addEventListener("click", () => Reveal.slide(0));

const ambience = document.getElementById("ambience");
function showAmbience() {
  ambience.setAttribute("aria-pressed", String(!sound.muted));
  ambience.querySelector("span").textContent = sound.muted ? "Sound off" : "Sound on";
}
ambience.addEventListener("click", () => {
  sound.setMuted(!sound.muted);
  showAmbience();
});
showAmbience();
