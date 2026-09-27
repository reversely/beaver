# Beaver

Beaver is the newcomer's field guide to Canada ("votre guide du Canada"): a person newly arrived
from abroad asks it how things work here and hears the answer in English, French, and their own
language. The guide has three parts:

| Part | What it covers | Status |
|---|---|---|
| Cultural fluency | Answers about Canada's history, institutions, languages, and places, kept as notebooks of the vocabulary, concepts, and dates each question taught | Built; answers citing their sources are planned in #27 |
| Duties and deadlines | The federal, provincial, and municipal dates that apply to the person, from official pages | Planned in #30 and #32 |
| Documents | A photographed letter or form, read and summarized on the laptop | Planned in #25 |

It runs as a rover on a Raspberry Pi 5, which a visitor asks through their phone, and as a desktop
app on a laptop. It is built for one person with one rover and one laptop.

## Parts

| Part | Folder | What it does |
|---|---|---|
| Rover | `src/beaver/rover` | A visitor asks through the phone page, because the rover has no microphone of its own. The rover transcribes the question on the Pi, redacts personal information, sends Gemini the redacted text with a camera frame, speaks the reply through ElevenLabs on its speaker, and saves the turn to a run folder. |
| Desktop app | `src/beaver/desktop` | A local web page at `http://127.0.0.1:8765/app/`, beside the home page at `/`. It starts the rover's phone page and shows its QR code, takes questions by voice or typing, replies sentence by sentence in each chosen language, and files every exchange into notebooks. Every 60 seconds it pulls the rover's new turns and files them too. |
| Home page | `web` | A static page for a laptop at a table: a spoken walk through the concept sheet, the "Hey Beaver..." exchanges, and the desktop app's screens. |
| Shared core | `src/beaver/core` | Config loading, run records, the Gemini and ElevenLabs calls, and the prompts both apps use. |

[`docs/how-it-works.md`](docs/how-it-works.md) draws the parts and what travels between them, and
the privacy filter that decides what Gemini receives; [`docs/architecture.md`](docs/architecture.md)
describes each part in detail.

## Setup

Beaver uses [uv](https://docs.astral.sh/uv/) for Python 3.13 and its dependencies.

```
uv sync --group desktop
uv run pre-commit install
```

`uv sync` builds the environment from `uv.lock` and installs the `beaver` package, so both apps can
import `beaver.core`. The API keys go in a `.env` file at the repo root, which git ignores:

```
GEMINI_API_KEY=...
ELEVENLABS_API_KEY=...
```

## Running

| Part | Command | Guide |
|---|---|---|
| Desktop app and demo | `uv run --group desktop python src/beaver/desktop/run.py serve`, then open `http://127.0.0.1:8765` | [`src/beaver/desktop/README.md`](src/beaver/desktop/README.md) |
| Rover, on the Pi | `uv run --group rover python src/beaver/rover/run.py phone` | [`src/beaver/rover/README.md`](src/beaver/rover/README.md) |
| Home page | Served by the desktop app at `http://127.0.0.1:8765` | [`web/README.md`](web/README.md) |

The rover's hardware, power, and network access are in [`docs/hardware.md`](docs/hardware.md).

## Tests

```
node --test src/beaver/desktop/tests/artifacts.test.mjs
uv run python -m unittest discover -s src/beaver/rover/tests
uv run python -m unittest discover -s src/beaver/desktop/tests
```

The first checks the desktop app's 3D piece registry against its spec; the second checks the
rover's guard rules, phone server, and language detection; the third checks the desktop app's
location lookup, whose fixed-point tests run once `run.py getplaces` has downloaded the boundary file. The pre-commit hook runs the first when the registry files change.

## Documentation

| File | Contents |
|---|---|
| [`docs/how-it-works.md`](docs/how-it-works.md) | Two diagrams: the parts and their connections, and the privacy filter with Gemini |
| [`docs/architecture.md`](docs/architecture.md) | The parts, the data each one keeps, sync, the shared core, and security |
| [`docs/hardware.md`](docs/hardware.md) | The rover: Raspberry Pi 5 on a SunFounder PiCar-X Robot HAT v4, power, and network access |
| [`docs/measurements.md`](docs/measurements.md) | Timings, token counts, costs, and model comparisons measured so far |

## Contributing

Work is tracked as GitHub issues in `reversely/beaver`. Each commit closes one issue with
`closes #N` in its message body, or carries `refs #N` while the issue's acceptance is incomplete.
