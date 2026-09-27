# Home page

A static page that introduces Beaver on a laptop at a table. It tells the concept sheet's two
paragraphs one line per page, plays the "Hey Beaver..." exchanges aloud, and shows the desktop
app's five features: Deadlines and duties, Documents, Ask Beaver, Notebooks, and Rover. It needs no API key and no server code: every spoken
line is a saved MP3, and the Ask and Notebook screens replay one recorded desktop-app exchange.

## Running

The desktop app's server serves this folder at `/` and the app at `/app/`, on one port:

```
uv run --group desktop python src/beaver/desktop/run.py serve
```

Then open `http://127.0.0.1:8765`. Scroll, press the arrow keys, or press **Play demo**, which
advances one slide every 8 seconds and loops.

## Menu

`nav.js` and `nav.css` draw the site menu on the home page and the app: Home (`/`), App
(`/app/`), and Rover (`/app/#rover`, the app's Rover panel). The published site has no app behind
it, so on any host but `127.0.0.1` or `localhost` the menu is left off, and elements marked
`data-site-local`, such as the closing page's **Open the app**, stay hidden. `<body data-site="online">` or `"local"` overrides the host check. A page with a
`[data-site-nav]` element gets the menu there; any other page gets it fixed at the top right.

## Pages

Every word on the story pages is the concept sheet's own text. Each of the two paragraphs has one
page. The first line shows when the page opens; each step (scroll, arrow key, or autoplay) reveals
the next line below the earlier ones, which stay in place and dim. The story sits at a fixed height
on the page, so no line moves or changes size between steps, and every sentence appears on one page.
The extra that belongs to a line (the hello buttons, the exchange slot, the diagram) shows below the
paragraph while that line is current.

| Page | Concept sheet text, one line per step | Interaction |
|---|---|---|
| Hello | "Hi, I'm Beaver" in eight languages; "the newcomer's field guide to Canada"; "votre guide du Canada" | The greeting streams in one language at a time |
| Newcomer | Being a newcomer in Canada can be **overwhelming**. / With **two national languages** / to a rich legacy of **arts**, **history** and **cultural references**, / there's a lot to learn. | On the second line, **English** and **Français** buttons play Beaver saying hello in each. On the third, each highlighted word opens its "Hey Beaver..." exchange (arts: the painting, history: Parliament, cultural references: poutine) and plays it |
| Beaver | **Beaver** is a friendly multilingual robot pet / that can act as your guide to the **context** behind the things you see every day, / transitioning fluidly between a speaker's **native language, French & English**. | On the last line, a diagram carries one sentence from Chinese to French to English; each card plays its language, and **Hear all three** plays them in order |
| Hey Beaver... | The three exchanges | The play button between question and answer plays the question in the visitor's language, then each answer line; any single line plays on its own; the line being spoken is highlighted |
| Deadlines and duties, Documents | What each feature does | |
| Ask Beaver, Notebooks | A recorded desktop-app exchange and its notebook entry | **Play reply** |
| Rover | What the rover does | |
| Close | Wordmark and **Start over** | |

## Sound

Every spoken line is an MP3 in `audio/`, generated once by `audio/build_audio.py` from
`audio/clips.json`, which holds each clip's exact text, language, and voice role:

```
uv run --group desktop python web/audio/build_audio.py
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
| `sample/` | Desktop run `20260926-110552-ui`: question, sentences, timings, notebook entry, audio, camera frame |

reveal.js 5.2.1 runs in scroll view and three.js 0.170.0 draws the scene; both load from jsDelivr
at pinned versions. Inter and Instrument Sans load from Google Fonts.

## Art pipeline

The scene is one painting cut into depth layers, so every layer shares one style and lines up.
Layers generated one at a time from separate prompts did not line up with the master or with each
other, and one came back in a different painting style, so only the master, the clouds, and the
branches are used.

```
uv run --with pillow --with numpy --with opencv-python-headless \
    python web/art/build_layers.py
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

Frame rate and layout checks are in [docs/measurements.md](../docs/measurements.md).
