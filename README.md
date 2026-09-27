# Beaver

Beaver answers questions about Canada aloud, in English, French, and the visitor's own language.
It runs as a rover on a Raspberry Pi 5 and as a desktop app on a laptop. The desktop app keeps
notebooks of the vocabulary, concepts, and dates that each question taught, including the
questions asked on the rover. It is built for one person with one rover and one laptop.

## Parts

| Part | Folder | What it does |
|---|---|---|
| Rover | `src/beaver/rover` | A visitor asks through the phone page, because the rover has no microphone of its own. The rover takes a camera frame, asks Gemini, speaks the reply through ElevenLabs on its speaker, and saves the turn to a run folder. |
| Desktop app | `src/beaver/desktop` | A local web page at `http://127.0.0.1:8765`. It takes questions by voice or typing, replies sentence by sentence in each chosen language, and files every exchange into notebooks. Every 60 seconds it pulls the rover's new turns and files them too. |
| Demo page | `demo` | A static page for a laptop at a table: a spoken walk through the concept sheet, the "Hey Beaver..." exchanges, and the desktop app's screens. |
| Shared core | `src/beaver/core` | Config loading, run records, the Gemini and ElevenLabs calls, and the prompts both apps use. |

```
phone page --HTTPS, Cloudflare quick tunnel--> rover --> Gemini, ElevenLabs
                                                 |
                                         runs/ on the Pi
                                                 ^
desktop app --SSH (rsync), pulled every 60 s-----+
     |
notebooks/notebooks.json on the laptop
```

[`docs/architecture.md`](docs/architecture.md) describes how the parts connect and why.

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
| Desktop app | `uv run --group desktop python src/beaver/desktop/run.py serve` | [`src/beaver/desktop/README.md`](src/beaver/desktop/README.md) |
| Rover, on the Pi | `uv run --group rover python src/beaver/rover/run.py phone` | [`src/beaver/rover/README.md`](src/beaver/rover/README.md) |
| Demo page | `uv run python -m http.server 8766 -d demo`, then open `http://127.0.0.1:8766` | [`demo/README.md`](demo/README.md) |

The rover's hardware, power, and network access are in [`docs/hardware.md`](docs/hardware.md).

## Tests

```
node --test src/beaver/desktop/tests/artifacts.test.mjs
uv run python -m unittest discover -s src/beaver/rover/tests
```

The first checks the desktop app's 3D piece registry against its spec; the second checks the
rover's guard rules. The pre-commit hook runs the first when the registry files change.

## Documentation

| File | Contents |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | The parts, the data each one keeps, sync, the shared core, and security |
| [`docs/hardware.md`](docs/hardware.md) | The rover: Raspberry Pi 5 on a SunFounder PiCar-X Robot HAT v4, power, and network access |
| [`docs/measurements.md`](docs/measurements.md) | Timings, token counts, costs, and model comparisons measured so far |

## Contributing

Work is tracked as GitHub issues in `reversely/beaver`. Each commit closes one issue with
`closes #N` in its message body, or carries `refs #N` while the issue's acceptance is incomplete.
