// The concept sheet's two paragraphs, one page each. Lines after the first are reveal.js fragments,
// so each step reveals the next line below the earlier ones without moving them. storyStep() marks
// the current line, dims the earlier ones, and shows the extra that belongs to the current line.
export function setupStory(sound) {
  // One click handler for everything that speaks: a highlighted word opens its "Hey Beaver..."
  // exchange under the paragraph; a single line plays itself; anything else with data-clips
  // (a button, a node, a whole exchange row) plays its sequence.
  document.addEventListener("click", (e) => {
    const word = e.target.closest(".word");
    if (word) return openExchange(word, sound);
    const line = e.target.closest("[data-clip]");
    if (line) return sound.speak([line.dataset.clip], line.closest(".qa") || document, null);
    const trigger = e.target.closest("[data-clips]");
    if (!trigger) return;
    const scope = trigger.closest(".qa") || trigger.closest(".story") || document;
    sound.speak(trigger.dataset.clips.split(" "), scope, trigger);
  });
}

function openExchange(word, sound) {
  const story = word.closest(".story");
  const slot = story.querySelector(".ex-slot");
  const exchange = document.getElementById("exchanges").content.getElementById(`ex-${word.dataset.ex}`).cloneNode(true);
  exchange.removeAttribute("id");
  slot.replaceChildren(exchange);
  story.querySelectorAll(".word").forEach((w) => w.classList.toggle("on", w === word));
  sound.speak(exchange.dataset.clips.split(" "), exchange, exchange.querySelector(".arrow"));
}


/** Mark a story page's current line and extra; returns the scene view for that line, or null. */
export function storyStep(slide) {
  const story = slide.querySelector(".story");
  if (!story) return null;
  const beats = [...story.querySelectorAll(".beat")];
  // The first line has no fragment; every revealed fragment is one more line.
  const now = 1 + beats.filter((b) => b.classList.contains("fragment") && b.classList.contains("visible")).length;
  for (const beat of beats) {
    const n = Number(beat.dataset.beat);
    beat.classList.toggle("past", n < now);
    beat.classList.toggle("now", n === now);
    // Only the current line's words open exchanges.
    for (const word of beat.querySelectorAll(".word")) word.disabled = n !== now;
  }
  for (const extra of story.querySelectorAll(".extra")) {
    extra.classList.toggle("on", Number(extra.dataset.for) === now);
  }
  return `${story.dataset.para}-${now}`;
}
