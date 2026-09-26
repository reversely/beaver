# Experiment 001: Gemini and ElevenLabs voice loop on the laptop

| | |
|---|---|
| Status | Active |
| Started | 2026-09-26 |
| Ticket | [#1](https://github.com/reversely/beaver/issues/1) |

This folder is a sandbox experiment. Code in `src/beaver/` never imports from it. A result that
proves out moves to product code through a new ticket that writes fresh code in `src/beaver/`; this
folder stays as the record of what was tried.

## Question

Can the laptop hear a spoken question, see a camera frame, answer with Gemini, and speak the answer
with ElevenLabs, and how many milliseconds does each step take?

## Running it

The experiment's libraries live in the `sandbox` dependency group, and the API keys come from
`GEMINI_API_KEY` and `ELEVENLABS_API_KEY` in the repo's `.env`.

```
uv run --group sandbox python experiments/001-gemini-elevenlabs/run.py <step> [words] [--set section.key=value]
```

| Step | What it does |
|---|---|
| `list` | Prints the Gemini models, ElevenLabs models, and ElevenLabs voices the keys can use. |
| `text` | 1. Sends a typed question to Gemini and prints the reply. |
| `speak` | 2. Sends text to ElevenLabs and plays the speech. |
| `voice` | 3. Records the microphone, sends the audio to Gemini, and speaks the reply. |
| `camera` | 4. Captures a camera frame, sends it to Gemini with a question, and speaks the reply. |
| `translate` | 5. Records the microphone and answers in the other of English and French. |
| `look` | 6. Sends the question (spoken, or typed after the step name) with a camera image, and speaks the reply. |
| `imagetest` | Sends each question in `[imagetest]` with no image and at each image resolution, skips speech, and writes `report.md` comparing replies, tokens, and timings. |
| `usage` | Prints the ElevenLabs plan, characters used and remaining, and the reset date. |

Examples:

```
run.py text "Who was Louis Riel?"
run.py voice --set microphone.record_seconds=5
run.py camera "What is on the table?" --set gemini.model=gemini-3.5-flash-lite
run.py look "What is this?" --set look.image_file=test-images/loonie.jpg
run.py imagetest --set gemini.model=gemini-3.5-flash-lite
```

`test-images/` holds downloaded test photos and is gitignored. `test-images/loonie.jpg` is
[Lucky Loonie](https://commons.wikimedia.org/wiki/File:Lucky_Loonie_(20111391984).jpg) by Evan
Delshaw, CC BY 2.0: the Lucky Loonie display at the Hockey Hall of Fame, with a visitor's finger
pointing at it.

## Desktop interface

```
uv run --group sandbox python experiments/001-gemini-elevenlabs/run.py serve
```

`serve` opens a local page at `http://127.0.0.1:8765` (`server.port`). The page takes a question by
holding the talk button or by typing, can attach a frame from the browser camera, and plays the
reply sentence by sentence while highlighting the sentence being spoken. The settings panel sets
`languages.official`, `languages.include_visitor_language`, `languages.order`, and `answer.mode`;
changes persist in `settings.local.json` (gitignored). The header's low-poly Parliament Hill
(`ui/scene.js`, three.js) takes its colours from a photo of the Hill: sandstone, copper-green
roofs, the Library's slate roof, and an evening sky. The page chrome stays brown on warm white; the
contrast ratios of its colour tokens are recorded at the top of `ui/style.css`.

### Translation backends

In pipeline mode, `translation.backend` chooses who translates the answer's sentences. `gemini`
sends one batched Gemini request. `argos` runs Argos Translate model packages locally on
CTranslate2 and SentencePiece, both open-source, without the `argostranslate` library, which pulls
in PyTorch through `stanza`. `run.py getmodels fr ar es zh-Hant` downloads models between English
and each language into `models/argos/` (gitignored); Argos covers 49 languages, including
Traditional Chinese (`zt`) apart from Simplified (`zh`). A pair with no direct model goes through
English, and a language with no model falls back to `translation.fallback`. The visitor's language
keeps its BCP 47 tag, so `zh-Hant` selects the Traditional model. A sentence in a language outside
`elevenlabs.spoken_languages` shows on the page in italics and is not synthesized; its
official-language partner is still spoken.

The Argos packages carry OPUS-MT models by Jörg Tiedemann and Santhosh Thottingal (University of
Helsinki), "OPUS-MT: Building open translation services for the World", EAMT 2020, licensed
CC-BY 4.0.

### Notebooks

After a turn's audio is ready, one text-only Gemini request (`prompts/notebook.md`) files the
exchange into a review notebook, reusing a notebook on the same story or starting one with a title
in English and French, a theme (civic, history, culture, or language), and a span of years. The
same request extracts up to `notebooks.max_vocabulary` terms in English, French, and the visitor's
language, up to `notebooks.max_concepts` concepts with a note on why each matters to someone living
in Canada, and dated moments, which the prompt limits to years the model is certain of. The
sidebar lists the notebooks; a notebook view shows the timeline in year order, vocabulary cards
that switch language on click, the concepts, and the questions asked. `#notebook=<id>` links open a
notebook directly. Notebooks persist in `notebooks/notebooks.json` (gitignored).

### Pieces

Each notebook shows a low-poly piece that the notebook request picks from eight: `peace_tower`,
`north_canoe`, `poutine`, `open_book`, `easel_jack_pine`, `flag`, `hockey`, and `loonie`. A
notebook with no piece falls back to one per theme, and `run.py pickpieces` asks Gemini once to
pick a piece for every notebook that has none. `artifacts.md` records each piece's real-world
dimensions with a source and confidence for every value. `ui/artifact-specs.js` holds the same
values in millimetres, and `ui/artifacts.js` builds each model from them, scaling to scene units
once. `ui/pieces.html` shows all eight with their build times and dimension checks.
`tests/artifacts.test.mjs` checks that the registry matches the spec, that every dimension check
passes, and that the Python and JavaScript piece lists agree.

The server listens on 127.0.0.1 only, serves audio only from inside `runs/`, accepts only the
listed settings and values, and caps requests at 15 MB. API keys stay on the server.

## Configuration and prompts

`config.toml` holds every model ID, voice ID, device, limit, and prompt value, with a comment on each.
`--set section.key=value` overrides one value for one run. The prompts live in `prompts/` as Markdown
files, and their `${name}` placeholders take values from `[prompt_vars]` in `config.toml`.

| File | Sent with |
|---|---|
| `prompts/system.md` | Every Gemini request, as the system prompt |
| `prompts/text.md` | Step 1, as the user message |
| `prompts/voice.md` | Step 3, with the recorded audio |
| `prompts/camera.md` | Step 4, with the camera frame |
| `prompts/translate.md` | Step 5, with the recorded audio |
| `prompts/look.md` | Step 6 and `imagetest`, with the image and the question |
| `prompts/typed_question.md` | Step 6 and `imagetest`, wrapping a typed question |

Each run prints the exact prompts sent to Gemini and the exact text sent to ElevenLabs. It also
saves a folder under `runs/` (gitignored) holding `record.json` (the config used, everything sent,
the reply, token counts, timings, and any error) plus the recorded question, the camera frame, and
the spoken reply as files.

## Costs and limits

- Gemini runs on the Google AI Studio free tier. On 2026-09-26, `gemini-3.8-flash` returned quota
  errors naming a limit of 20 requests (`generate_content_free_tier_requests`) at 02:04, 02:09, and
  02:14, then answered normally at 02:19, so the limit window is shorter than a day. Google's
  rate-limit page lists per-model limits only in AI Studio.
  `gemini.retries` retries 503 "high demand" errors; a quota error stops the run.
- ElevenLabs runs on the Creator plan: 131,000 characters a month, resetting on the 25th.
  `run.py usage` shows the balance, each run prints its character count, and
  `elevenlabs.max_characters` stops any single request above that size before it is sent.
- Google's terms allow free-tier prompts and replies to be used to improve its products. Check the
  billing setting and terms before recording members of the public.

## Results

Measured on 2026-09-26 on the MacBook, with the default `config.toml` unless noted.

| Step | Setting | Measurement |
|---|---|---|
| 1 text | `gemini-3.8-flash`, thinking `low` | Gemini reply in 10.4, 1.2, 3.2, 9.9, and 3.4 s over five runs |
| 1 text | `gemini-3.5-flash-lite` | Gemini reply in 1.0 s over one run |
| 1 text | `gemini-3.8-flash`, thinking `minimal` | Rejected: the model does not support `minimal` |
| 2 speak | `eleven_multilingual_v2`, 58 characters | First audio at 1.6 s, full audio at 1.7 s, 4.0 s of playback |
| 2 speak | "Bienvenue au Canada. Welcome to Canada.", 3 runs | First audio at 1.2, 1.3, and 6.3 s |
| 3 voice | `gemini-3.8-flash`, 4.5 s question | Gemini 29.3 s, first audio 10.6 s |
| 3 voice | `gemini-3.8-flash`, 2.1 s question | Gemini 1.6 s, first audio 1.9 s; audio cost 52 prompt tokens |
| 4 camera | | Not yet run |
| 5 translate | | Not yet run |
| imagetest | `gemini-3.5-flash-lite`, 5 questions x 4 image variants | See below |
| bilingualtest | `gemini` translation, 3 cases, playback off | Translation 1,060 to 1,341 ms; first audio 4.3 to 7.3 s; peak memory 87 MB |
| bilingualtest | `argos` translation, 3 cases, playback off | Translation 385 to 481 ms; first audio 3.6 to 4.3 s; peak memory 220 MB; 206 to 252 fewer Gemini tokens per case |
| Argos alone | 3 sentences, int8, 2 threads | 143 to 188 ms warm per language; 300 to 1,200 ms to load a model; about 150 MB per loaded model |
| Pieces | 8 pieces at 200 px, headless Chrome | 223 ms on a cold start, 96 ms on a second run; the first piece takes 74 ms for WebGL setup and the rest 1 to 8 ms each |

### Translation comparison, 2026-09-26

Gemini wrote each English answer; the two backends then translated the same kind of answer. The
Gemini translations read fluently and keep the English name in brackets, as in
"برج السلام (Peace Tower)". The Argos translations carried errors a visitor would notice:

- Arabic: "Parliament Hill" became "البرلمان هيل", keeping "Hill" as a sound, and "Centre Block"
  became "مركز "بلوك"".
- Spanish: "nineteen seventeen" became "diecinueve y diecisiete años", and "wilderness" became
  "desierto", which means desert.
- Traditional Chinese: the first sentence lost its second half, "cheese" doubled as "奶酪奶酪", and
  Simplified forms such as "制成" appeared.
- Swahili: "fresh cheese curds topped with warm brown gravy" became "curds safi cheese kuchorea na
  gravy joto kahawia", leaving English words in place.

The spelled-out year comes from `prompts/system.md`, which asks Gemini to write numbers and dates
the way a person would say them. Sentence-level translation models read "nineteen seventeen" as
words, so the Spanish rendering fails where Gemini's own translation wrote 1917.

### Image test, 2026-09-26

Run `runs/20260926-020707-imagetest` sent five typed questions with `test-images/loonie.jpg` to
`gemini-3.5-flash-lite`, once each with no image and with the image at `low`, `default`, and `high`
media resolution. A partial run on `gemini-3.8-flash` (8 requests before the quota error) produced
identical token counts.

Prompt tokens:

| Image | Image tokens | Prompt tokens | Increase over no image |
|---|---|---|---|
| none | 0 | 320 to 328 | |
| low | 260 | 580 to 588 | 1.8 times |
| default | 1080 | 1400 to 1408 | 4.4 times |
| high | 1080 | 1400 to 1408 | 4.4 times |

- The model's default image resolution cost the same 1080 tokens as `high`.
- Reply tokens stayed between 38 and 75 in every case. Thinking tokens appeared in 3 of 20 requests,
  at 482 to 614 tokens each, which is up to ten times the reply.
- Gemini times ranged from 1.0 to 17.1 s with no pattern by image variant.

Replies:

- Unrelated questions ("Who was Louis Riel?", "Why does Canada have two official languages?") never
  mentioned the image at any resolution, as `prompts/look.md` instructs.
- "What is this?" with no image produced an invented scene: "From my camera view, it looks like you
  are checking out a classic red Canadian post box". The system prompt says the rover has a camera,
  and `prompts/look.md` says an image is attached even when none is.
- The `low` image replies named the Lucky Loonie and the 2002 Salt Lake City Olympics for both
  "refers" questions. The `default` and `high` replies described a hockey faceoff and did not name
  the display. Each variant ran once at temperature 0.7, so this does not establish that lower
  resolution identifies better.
- "Tell me more about it." used the image when one was attached and asked the visitor to repeat
  the question when none was.

Observations:

- `gemini-3.8-flash` reply times varied tenfold across identical requests, so a single timing does
  not characterize it. The slowest voice turn took 29.3 s in Gemini and 10.6 s to first audio.
- ElevenLabs first audio usually arrived in 1.2 to 1.9 s, with two runs at 6.3 and 10.6 s.
- A 2.1 s spoken question cost 52 audio tokens, about 25 tokens per second of audio.
- One `gemini-3.5-flash-lite` reply to "Why does Canada have two official languages?" placed official
  recognition in the seventeen hundreds; its four image-test replies all gave nineteen sixty-nine. The Official Languages Act passed in 1969, which the
  `gemini-3.8-flash` reply stated.
