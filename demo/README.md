# Experiment 003: laptop demo of the setup sequence and a sample conversation

| | |
|---|---|
| Status | Active |
| Started | 2026-09-26 |
| Builds on | [Experiment 001](../src/beaver/desktop/README.md), [Experiment 002](../src/beaver/rover/README.md) |
| Tickets | [#9](https://github.com/reversely/beaver/issues/9), [#10](https://github.com/reversely/beaver/issues/10), [#15](https://github.com/reversely/beaver/issues/15) |

This folder is a static page that introduces Beaver on a laptop. It needs no API key and no
server code. The sample conversation replays a recorded experiment 001 run; the "Hey Beaver..."
exchanges come from the concept sheet.

## Question

Can one scrolling page explain what Beaver is, what it knows, and how you set up your rover from
the desktop app, clearly enough to run unattended at a table?

## Running it

```
uv run python -m http.server 8766 -d demo
```

Then open `http://127.0.0.1:8766`. Scroll, press the arrow keys, or press **Play demo**, which
advances one slide every 8 seconds and loops.

## Pages

Every word on the story pages is the concept sheet's own text. The two paragraphs are told one
line per page: the current line is set large with its key words highlighted, and the earlier lines
of the paragraph stay above it, smaller and dimmed.

| Page | Concept sheet text | Interaction |
|---|---|---|
| Hello | "Hi, I'm Beaver" in eight languages; "the newcomer's field guide to Canada"; "votre guide du Canada" | The greeting streams in one language at a time |
| Newcomer 1 | Being a newcomer in Canada can be **overwhelming**. | |
| Newcomer 2 | With **two national languages** | **English** and **Français** buttons play Beaver saying hello in each |
| Newcomer 3 | to a rich legacy of **arts**, **history** and **cultural references**, | Each word opens its "Hey Beaver..." exchange (arts: the painting, history: Parliament, cultural references: poutine) and plays it |
| Newcomer 4 | there's a lot to learn. | |
| Beaver 1 | **Beaver** is a friendly multilingual robot pet | |
| Beaver 2 | that can act as your guide to the **context** behind the things you see every day, | |
| Beaver 3 | transitioning fluidly between a speaker's **native language, French & English**. | A diagram carries one sentence from Chinese to French to English; each card plays its language, and **Hear all three** plays them in order |
| Hey Beaver... | The three exchanges | The play button between question and answer plays the question in the visitor's language, then each answer line; any single line plays on its own; the line being spoken is highlighted |
| Site, Deploy | Your settings on the laptop and sending them to the rover | The deploy progress changes on a timer |
| Ask, Notebook | The recorded experiment 001 exchange and its notebook entry | **Play reply** |
| Close | Wordmark and **Start over** | |

The Site and Deploy screens are demo screens: nothing is sent to the rover. Each screen carries a
`demo` tag.

## Sound

Every spoken line is an MP3 in `audio/`, generated once by `audio/build_audio.py` from
`audio/clips.json`, which holds each clip's exact text, language, and voice role:

```
uv run --group sandbox python demo/audio/build_audio.py
```

| Role | ElevenLabs voice | Used for |
|---|---|---|
| Beaver | Chadwitch (en-CA), `eleven_multilingual_v2` | Beaver's lines in English, Arabic, Spanish, and Chinese |
| Beaver in French | Adam, a Québécois voice added from the ElevenLabs voice library | Beaver's French lines |
| Visitor | Sarah | The visitors' questions |

The 19 clips took 977 characters. The script skips any clip whose MP3 already exists, so editing
one line and deleting its MP3 regenerates only that clip.

An autumn park ambience (wind in dry leaves, a distant river, far-off birds), 22 seconds from the
ElevenLabs sound-effects endpoint, loops under the page. Browsers allow sound only after a click
or key press, so the loop starts on the first one; it drops from 22% to 6% volume while a clip
plays. **Sound on** in the lower right mutes it, and the choice is remembered in the browser.

## Files

| File | Role |
|---|---|
| `index.html` | Slides and the laptop's screens |
| `demo.js` | reveal.js setup, greeting cycle, per-slide screen changes, the sample exchange, autoplay |
| `story.js` | Builds each story page from its paragraph template and handles words, lines, and speaker buttons |
| `sound.js` | Plays clips in order with line highlighting, and runs the ambience loop and its mute |
| `audio/` | `clips.json`, `build_audio.py`, and the generated MP3s |
| `scene.js` | The painted layers on planes at their depths, the camera views, branches, and falling leaves |
| `style.css` | Palette roles, measured contrast, slide and laptop layout |
| `art/source/*.webp` | Three GPT Image 2 generations: the master painting, clouds, and maple branches |
| `art/build_layers.py` | Cuts the sources into the layers below |
| `art/*.webp` | Layers: `clouds`, `land`, `parliament`, `foreground` (branches), `leaf-2` (falling leaf) |
| `beaver-mark.png` | The Beaver mark from the concept sheet, used as the page icon; a placeholder until final branding |
| `sample/` | Run `20260926-110552-ui`: question, sentences, timings, notebook entry, audio, camera frame |

reveal.js 5.2.1 runs in scroll view and three.js 0.170.0 draws the scene; both load from jsDelivr
at pinned versions. Inter and Instrument Sans
load from Google Fonts.

## Art pipeline

The scene is one painting cut into depth layers, so every layer shares one style and lines up.
Layers generated one at a time from separate prompts did not line up with the master or with each
other, and one came back in a different painting style, so only the master, the clouds, and the
branches are used.

```
uv run --with pillow --with numpy --with opencv-python-headless \
    python demo/art/build_layers.py
```

`build_layers.py` removes the master's cream sky by flood fill from the top edge, cuts Parliament's
buildings out of a fixed box (leaving the pale hills behind them on the land layer), refills that
box on the land layer row by row from the colours on either side, keys the clouds off their
orange field, and keys the branches off magenta by blue-over-green, because maple red sits close
to magenta in plain colour distance.

`scene.js` places each layer on a plane at its depth and scales it by that depth, so from the
base camera the layers reassemble the painting. The camera only pans and pushes in, and each view
is clamped so the visible area stays inside the land painting at any window shape. Parliament sits
1.6 units in front of the land, so the refilled strip behind it shows only as a thin sliver.

## Design

Text sits either on the painted sky in deep maroon, or on dark maroon surfaces in near-white; the
measured contrast of each pair is recorded at the top of `style.css`. On the greeting and closing
slides a light cream scrim covers the left of the screen and fades out by 60% of its width, so the
maroon text reads while Parliament stays clear on the right. Every line there stays on one line:
`demo.js` sizes the greeting once from the longest translation ("ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਮੈਂ Beaver ਹਾਂ" or
"Kumusta, ako si Beaver", depending on the font), so the type holds one size as the languages
change, and shrinks any other line that would wrap. The product name stays in Latin letters in
every language. Each greeting streams in behind a soft gradient edge
that moves in the greeting's reading direction; a letter-by-letter reveal would break the joined
letters of Arabic and Punjabi. The page's one gradient is
the sky behind the painting. Reduced motion stops the falling leaves, the camera moves, the
greeting cycle, and the screen animations.

## Results

| Test | Setting | Measurement |
|---|---|---|
| Frame rate | Chrome, Apple A18 Pro GPU, 1440 x 900, 5 s on the first slide | 60.1 frames per second; longest frame 17 ms |
| Layout audit | 1024, 1280, 1440, 1920 px, first slide | 0 fails, 0 warnings |
| Slide screenshots | 1024 x 700, 1440 x 900, 1920 x 1080 | Every setup screen fits its laptop; the camera never shows past the painting's edge |
