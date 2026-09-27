# Desktop app

The desktop app runs on the laptop. It answers questions by voice or typing in English, French,
or both, adds the visitor's own language to each sentence when asked, and files every exchange,
including the rover's, into notebooks. How it fits with the rover is in
[docs/architecture.md](../../../docs/architecture.md); timings and costs are in
[docs/measurements.md](../../../docs/measurements.md).

## Running

The API keys come from `GEMINI_API_KEY` and `ELEVENLABS_API_KEY` in the repo's `.env`.

```
uv run --group desktop python src/beaver/desktop/run.py <command> [words] [--set section.key=value]
```

| Command | What it does |
|---|---|
| `serve` | Opens the page at `http://127.0.0.1:8765` and pulls the rover's turns every 60 seconds |
| `sync` | Pulls the rover's turns once and files the new ones; run it only while `serve` is stopped |
| `text` | Sends a typed question to Gemini and prints the reply |
| `speak` | Sends text to ElevenLabs and plays the speech |
| `voice` | Records the microphone, sends the audio to Gemini, and speaks the reply |
| `camera` | Captures a camera frame, sends it to Gemini with a question, and speaks the reply |
| `translate` | Records the microphone and answers in the other of English and French |
| `look` | Sends a question (spoken, or typed after the command) with a camera frame and speaks the reply |
| `bilingual` | Answers sentence by sentence in each chosen language |
| `bilingualtest` | Runs the concept-sheet questions through the bilingual reply |
| `imagetest` | Sends each question in `[imagetest]` with no image and at each image resolution, and writes `report.md` comparing replies, tokens, and timings |
| `pickpieces` | Asks Gemini to pick a 3D piece for every notebook that has none |
| `getmodels` | Downloads Argos translation models, for example `getmodels fr ar es zh-Hant` |
| `getplaces` | Downloads Statistics Canada's 2021 census subdivision boundaries (40 MB) for the phone-location lookup |
| `list` | Prints the Gemini models, ElevenLabs models, and voices the keys can use |
| `usage` | Prints the ElevenLabs plan, characters used and remaining, and the reset date |

```
run.py text "Who was Louis Riel?"
run.py voice --set microphone.record_seconds=5
run.py look "What is this?" --set look.image_file=test-images/loonie.jpg
```

`test-images/` holds downloaded test photos and is gitignored. `test-images/loonie.jpg` is
[Lucky Loonie](https://commons.wikimedia.org/wiki/File:Lucky_Loonie_(20111391984).jpg) by Evan
Delshaw, CC BY 2.0: the Lucky Loonie display at the Hockey Hall of Fame.

## The page

The page takes a question by holding the talk button or by typing, can attach a frame from the
laptop camera, and plays the reply sentence by sentence while highlighting the sentence being
spoken. The settings panel sets `languages.official`, `languages.include_visitor_language`,
`languages.order`, and `answer.mode`; changes persist in `settings.local.json` (gitignored).

The header's low-poly Parliament Hill (`ui/scene.js`, three.js) takes its colours from a photo of
the Hill. A night scene over the Canadian Shield fills the page behind every view
(`ui/background.js`, inline SVG): hills, a spruce treeline, a lake with a canoe, a campfire, and a
grainy aurora as the one light source. Content sits on translucent dark cards with near-white text,
at least 6.2:1 contrast for body text and 3.8:1 for metadata even over the aurora's brightest point;
the measured ratios of each colour token are at the top of `ui/style.css`. The scene holds 60 frames
per second at 1440 px, and reduced motion stops its movement.

The page works from 360 px phones to wide desktops. Below 900 px the sidebar stacks on top,
settings collapse into a disclosure, and notebooks scroll sideways. Touch screens get 44 px targets.

## Translation

In pipeline mode, `translation.backend` chooses who translates the answer's sentences. `gemini`
sends one batched Gemini request. `argos` runs Argos Translate model packages locally on
CTranslate2 and SentencePiece, without the `argostranslate` library, which pulls in PyTorch.
`run.py getmodels` downloads models between English and each language into `models/argos/`
(gitignored). A pair with no direct model goes through English, and a language with no model falls
back to `translation.fallback`. A sentence in a language outside `elevenlabs.spoken_languages`
shows on the page in italics and is not spoken; its official-language partner still is.

The Argos packages carry OPUS-MT models by Jörg Tiedemann and Santhosh Thottingal (University of
Helsinki), "OPUS-MT: Building open translation services for the World", EAMT 2020, CC-BY 4.0.

## Notebooks

After a turn's audio is ready, one Gemini request (`prompts/notebook.md`) files the exchange into a
notebook, reusing one on the same story or starting one with a title in English and French, a theme
(civic, history, culture, or language), and a span of years. The same request extracts up to
`notebooks.max_vocabulary` terms in English, French, and the visitor's language, up to
`notebooks.max_concepts` concepts with a note on why each matters to someone living in Canada, and
dated moments limited to years the model is certain of. A notebook view shows the timeline, vocabulary
cards that switch language on click, the concepts, and the questions asked; entries that came from
the rover carry a `rover` tag. `#notebook=<id>` links open a notebook directly. Notebooks persist in
`notebooks/notebooks.json` (gitignored).

## 3D pieces

Each notebook shows a low-poly piece picked from eight: `peace_tower`, `north_canoe`, `poutine`,
`open_book`, `easel_jack_pine`, `flag`, `hockey`, and `loonie`. `artifacts.md` records each
piece's real-world dimensions with a source and confidence for every value; `ui/artifact-specs.js`
holds the same values in millimetres, and `ui/artifacts.js` builds each model from them.
`ui/pieces.html` shows all eight. `tests/artifacts.test.mjs` checks that the registry matches the
spec, that every dimension check passes, and that the Python and JavaScript piece lists agree.

## Rover sync

`serve` pulls the rover's turns every `sync.interval_seconds` (60), and `sync` pulls once. Each pass
copies each new run folder's `record.json` and `frame.jpg` from `sync.remote_runs` on `sync.host`
over SSH into `rover-runs/` (gitignored) and files the redacted question the rover wrote down on
board like any other exchange. For a turn saved before on-board transcription, the pass also pulls
`question.wav` and writes the question down with one Gemini request (`prompts/rover_question.md`). A
`filed.json` marker keeps a turn from being filed twice.

## Phone location

When a visitor taps "Use my location" on the rover's phone page, each later rover turn carries the
phone's position rounded to 2 decimals (about 1 km). After each pull, the sync maps the newest one
to a province and municipality with `place.py`, a point-in-polygon lookup against Statistics
Canada's 2021 census subdivision digital boundary file, and Settings shows it as "from phone". The
lookup runs on this laptop, so coordinates never reach a geocoding service; `run.py getplaces`
downloads the file into `places/` (gitignored) once. The digital file keeps each subdivision's
water, so a point on the Ottawa River still maps to Ottawa or Gatineau. A lookup took 8 to 18 ms,
90 ms on the first read, and `place.py` loads only when first used.

Source: Statistics Canada, 2021 Census Subdivision Boundary File (lcsd000a21a_e). Reproduced and
distributed on an "as is" basis with the permission of Statistics Canada, under the Statistics
Canada Open Licence.

## Configuration and prompts

`config.toml` holds every model ID, voice ID, device, limit, and prompt value, with a comment on
each; `--set section.key=value` overrides one value for one run. Prompt files are looked up in this
folder's `prompts/`, then in `src/beaver/core/prompts/`, where the system, look, text, and
typed-question prompts that the rover also uses live. Their `${name}` placeholders take values from
`[prompt_vars]`.

Each run prints the exact prompts sent to Gemini and the exact text sent to ElevenLabs, and saves a
folder under `runs/` (gitignored) with `record.json` (the config used, everything sent, the reply,
token counts, timings, and any error) and the question, camera frame, and reply audio.
