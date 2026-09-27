// Spoken clips and the ambient autumn bed. The clips are MP3s generated once by
// audio/build_audio.py; nothing here calls ElevenLabs.
const BED_LEVEL = 0.22;
const BED_UNDER_VOICE = 0.06;

// Clips whose id starts with "q" are the visitors' questions; every other clip is Beaver's.
const isQuestion = (id) => id.startsWith("q");

// voice(audio) plays one of Beaver's clips with Beaver's mouth moving; without it clips just play.
export function createSound({ voice } = {}) {
  let ctx = null;
  let bed = null;
  let muted = false;
  try {
    muted = localStorage.getItem("beaver-ambience") === "off";
  } catch {}
  let playing = null;
  let token = 0;

  function level() {
    if (!bed) return;
    const target = muted ? 0 : playing ? BED_UNDER_VOICE : BED_LEVEL;
    bed.gain.setTargetAtTime(target, ctx.currentTime, 0.4);
  }

  // Browsers allow sound only after a click or key press, so the bed starts on the first one.
  async function startBed() {
    if (ctx) return;
    ctx = new AudioContext();
    bed = ctx.createGain();
    bed.gain.value = 0;
    bed.connect(ctx.destination);
    const data = await (await fetch("audio/ambience-park.mp3")).arrayBuffer();
    const source = ctx.createBufferSource();
    source.buffer = await ctx.decodeAudioData(data);
    source.loop = true;
    source.connect(bed);
    source.start();
    level();
  }
  for (const type of ["pointerdown", "keydown"]) {
    document.addEventListener(type, startBed, { once: true });
  }

  function stop() {
    token++;
    playing?.audio.pause();
    playing?.button?.classList.remove("playing");
    playing = null;
    document.querySelectorAll(".speaking").forEach((el) => el.classList.remove("speaking"));
    level();
  }

  // Plays clips in order, marking each line that carries the clip's id inside `scope` while it
  // plays. A new call, or stop(), cuts the current sequence off.
  async function speak(ids, scope = document, button = null) {
    stop();
    const mine = token;
    button?.classList.add("playing");
    for (const id of ids) {
      if (mine !== token) return;
      const lines = scope.querySelectorAll(`[data-clip="${id}"]`);
      lines.forEach((el) => el.classList.add("speaking"));
      const audio = new Audio(`audio/${id}.mp3`);
      playing = { audio, button };
      level();
      await new Promise((done) => {
        audio.onended = done;
        audio.onerror = done;
        (voice && !isQuestion(id) ? voice(audio) : audio.play()).catch(done);
      });
      lines.forEach((el) => el.classList.remove("speaking"));
    }
    if (mine === token) stop();
  }

  function setMuted(value) {
    muted = value;
    try {
      localStorage.setItem("beaver-ambience", muted ? "off" : "on");
    } catch {}
    level();
  }

  return { speak, stop, setMuted, get muted() { return muted; } };
}
