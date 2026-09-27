// The concept sheet's two paragraphs, one line per page. Each .story page clones its paragraph
// from a <template> and marks every line as past, now, or next relative to its own line, so the
// paragraph builds up page by page with the current line largest.
export function setupStory(sound) {
  for (const story of document.querySelectorAll(".story")) {
    const template = document.getElementById(`para-${story.dataset.para}`);
    story.prepend(template.content.cloneNode(true));
    const now = Number(story.dataset.beat);
    for (const beat of story.querySelectorAll(".beat")) {
      const n = Number(beat.dataset.beat);
      beat.classList.add(n < now ? "past" : n === now ? "now" : "next");
    }
    // Words on earlier lines stay readable but stop being buttons.
    for (const word of story.querySelectorAll(".beat:not(.now) .word")) word.disabled = true;
  }

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
  const exchange = document.getElementById(`ex-${word.dataset.ex}`).cloneNode(true);
  exchange.removeAttribute("id");
  slot.replaceChildren(exchange);
  story.querySelectorAll(".word").forEach((w) => w.classList.toggle("on", w === word));
  sound.speak(exchange.dataset.clips.split(" "), exchange, exchange.querySelector(".arrow"));
}
