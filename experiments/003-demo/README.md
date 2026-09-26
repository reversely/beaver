# Experiment 003: laptop demo of the setup sequence and a sample conversation

| | |
|---|---|
| Status | Active |
| Started | 2026-09-26 |
| Builds on | [Experiment 001](../001-gemini-elevenlabs/README.md), [Experiment 002](../002-raspberry-pi/README.md) |
| Ticket | [#9](https://github.com/reversely/beaver/issues/9) |

This folder is a static page that introduces Beaver on a laptop. It needs no API key and no
server code; every reply it shows comes from a recorded experiment 001 run.

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
| beaver | Name and one-line description in English and French | The town from above the river |
| Rover | Hardware and features | The beaver at its dam |
| Knowledge | Topics and rules from the guide prompt, and questions answered in testing | The clock tower |
| Sign in | Operator sign-in on the laptop | The river bend |
| Site | Site name, reply languages, topics, and voice | Over the town from the north |
| Pairing | The laptop shows a QR code for the rover's camera | Street level below the tower |
| Deployment | Settings go to the rover | Overhead |
| Visitor session | Session code and QR code for visitor phones | The riverbank maples |
| Sample conversation | A recorded question, camera frame, and reply | The dam from downstream |
| Notebook | The notebook entry filed from that exchange | The town from the west |
| beaver | Closing slide with **Start over** | The town from the south |

The setup screens (sign-in to visitor session) are demo screens: the pairing status and deploy
progress change on a timer, and no account, rover, or session exists behind them. Each screen
carries a `demo` tag.

## Files

| File | Role |
|---|---|
| `index.html` | Slides and the laptop's operator screens |
| `demo.js` | reveal.js setup, per-slide screen changes, QR codes, the sample exchange, autoplay |
| `scene.js` | three.js autumn town: ground, river, roads, buildings, clock tower, maples, falling leaves, dam, beaver |
| `style.css` | Palette roles, measured contrast, slide and laptop layout |
| `sample/exchange.json` | Question, sentences, timings, and notebook entry from experiment 001 run `20260926-110552-ui` |
| `sample/*.mp3`, `sample/frame.jpg` | That run's sentence audio (WAV converted to 48 kbps mono MP3) and camera frame |

reveal.js 5.2.1 runs in scroll view, three.js 0.170.0 draws the scene, and qrcode-generator 1.4.4
draws the QR codes; all three load from jsDelivr at pinned versions.

## Design

The palette is five colours: `#814E2B` brown, `#9F0A28` red, `#D55C2B` orange, `#F6E7D3` cream,
and `#89A46F` sage. Every colour in the scene is one of these or a fixed mix of two, and the
copper-green tower roof uses the sage. Text sits only on cream cards; the measured contrast of
each text colour is recorded at the top of `style.css`. Orange and sage carry no text.

The scene's camera eases to a new view on every slide. The laptop on the setup slides stays fixed
while those slides scroll, and its screen contents scale with its width, so each screen fits at
every window size. Reduced motion stops the falling leaves, the camera moves, and the screen
animations.

## Results

| Test | Setting | Measurement |
|---|---|---|
| Frame rate | Chrome, Apple A18 Pro GPU, 1440 x 900, 5 s on the first slide | 60.0 frames per second; longest frame 33 ms |
| Layout audit | 1024, 1280, 1440, 1920 px, first slide | 0 fails, 0 warnings |
| Slide screenshots | 1024 x 700, 1440 x 900, 1920 x 1080 | Every setup screen fits its laptop; no card overlaps the laptop |
