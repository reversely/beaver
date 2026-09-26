# Experiment 003: laptop demo of the setup sequence and a sample conversation

| | |
|---|---|
| Status | Active |
| Started | 2026-09-26 |
| Builds on | [Experiment 001](../001-gemini-elevenlabs/README.md), [Experiment 002](../002-raspberry-pi/README.md) |
| Tickets | [#9](https://github.com/reversely/beaver/issues/9), [#10](https://github.com/reversely/beaver/issues/10) |

This folder is a static page that introduces Beaver on a laptop. It needs no API key and no
server code. The sample conversation replays a recorded experiment 001 run; the "Hey Beaver..."
exchanges come from the concept sheet.

## Question

Can one scrolling page explain what Beaver is, what it knows, and how an operator sets up one rover
for a visitor session, clearly enough to run unattended at a table?

## Running it

```
uv run python -m http.server 8766 -d experiments/003-demo
```

Then open `http://127.0.0.1:8766`. Scroll, press the arrow keys, or press **Play demo**, which
advances one slide every 8 seconds and loops.

## Slides

| Slide | Content | Scene view |
|---|---|---|
| Greeting | "Hi" streaming in through eight languages above the Beaver wordmark and "the newcomer's field guide to Canada", text only, on one left edge | Pushed in on Parliament Hill, framed by maple branches |
| Newcomer | The concept sheet's two-column introduction | The whole painting |
| Hey Beaver... | The concept sheet's three exchanges in Arabic, Spanish, and Chinese with English | Panned over the river |
| Sign in, Site, Pair, Deploy, Session | The host's setup for one rover on the laptop | A slow pan across the town per step |
| Ask | The recorded experiment 001 exchange inside the laptop, with **Play reply** | The river bank |
| Notebook | The notebook entry filed from that exchange | The far bank |
| Close | Wordmark and **Start over** | Parliament Hill, framed by branches |

The setup screens are demo screens: the pairing status and deploy progress change on a timer,
and no account, rover, or session exists behind them. The QR codes scan, but they hold placeholder
strings (`beaver-demo:pair:ROVER-1`, `beaver-demo:join:BVR-4K7`) that nothing reads yet. Each
screen carries a `demo` tag.

## Files

| File | Role |
|---|---|
| `index.html` | Slides and the laptop's screens |
| `demo.js` | reveal.js setup, greeting cycle, per-slide screen changes, QR codes, the sample exchange, autoplay |
| `scene.js` | The painted layers on planes at their depths, the camera views, branches, and falling leaves |
| `style.css` | Palette roles, measured contrast, slide and laptop layout |
| `art/source/*.webp` | Three GPT Image 2 generations: the master painting, clouds, and maple branches |
| `art/build_layers.py` | Cuts the sources into the layers below |
| `art/*.webp` | Layers: `clouds`, `land`, `parliament`, `foreground` (branches), `leaf-2` (falling leaf) |
| `beaver-mark.png` | The Beaver mark from the concept sheet, used as the page icon; a placeholder until final branding |
| `sample/` | Run `20260926-110552-ui`: question, sentences, timings, notebook entry, audio, camera frame |

reveal.js 5.2.1 runs in scroll view, three.js 0.170.0 draws the scene, and qrcode-generator 1.4.4
draws the QR codes; all three load from jsDelivr at pinned versions. Inter and Instrument Sans
load from Google Fonts.

## Art pipeline

The scene is one painting cut into depth layers, so every layer shares one style and lines up.
Layers generated one at a time from separate prompts did not line up with the master or with each
other, and one came back in a different painting style, so only the master, the clouds, and the
branches are used.

```
uv run --with pillow --with numpy --with opencv-python-headless \
    python experiments/003-demo/art/build_layers.py
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
`demo.js` shrinks a line's type until it fits its column, so a long greeting such as ਸਤ ਸ੍ਰੀ ਅਕਾਲ
gets smaller type instead of a second line. Each greeting streams in behind a soft gradient edge
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
