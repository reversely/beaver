# Architecture

![Parts of Beaver: on the rover, local processing puts a guard proxy between the rover and the remote AI services; the proxy sends Gemini clean text and a photo and sends ElevenLabs the checked answer; the desktop app sends Gemini and ElevenLabs its own questions and copies each saved rover turn over SSH every 60 seconds](img/how-it-works-parts.svg)

The rover answers questions without the laptop. The desktop app pulls each rover turn afterwards
and files it into a notebook.

## A rover turn

The rover has no microphone ([hardware.md](hardware.md)), so the visitor asks through their phone.

1. `run.py phone` serves a page on port 8770 through a Cloudflare quick tunnel and prints its
   address as a QR code. The address carries a token that changes at every start; requests without
   it get 403.
2. The visitor picks one of eight languages and holds the button to ask. The phone uploads 16 kHz
   mono WAV.
3. On the Pi, Whisper transcribes the question and the guard proxy replaces personal information.
4. Gemini receives the clean text and a camera frame, never the audio.
5. The guard proxy checks the answer, ElevenLabs speaks it, and the mouth screen moves with it.

![Guard proxy: the recording stays on the rover; Whisper transcribes it and the guard proxy replaces personal information, so Gemini receives clean text and a photo; the proxy checks the answer before ElevenLabs converts it into speech](img/how-it-works-privacy.svg)

[how-it-works.md](how-it-works.md) lists what the guard proxy replaces and checks.

## What each part keeps

| Part | Location | Contents |
|---|---|---|
| Rover turn | `src/beaver/rover/runs/<time>-<kind>/` on the Pi | `record.json` (config, requests, reply, tokens, timings, which guard rules fired), `question.wav`, `frame.jpg`, `reply.wav` |
| Pulled turn | `src/beaver/desktop/rover-runs/` on the laptop | The turn's `record.json` and `frame.jpg`, plus `filed.json` once filed |
| Notebooks | `src/beaver/desktop/notebooks/notebooks.json` | Every exchange by topic: bilingual title, theme, years, vocabulary in three languages, concepts, dated moments |

All three are gitignored. The question audio never leaves the Pi.

## Sync

The Pi cannot open a connection to the laptop, so the laptop pulls. Every 60 seconds while
`run.py serve` runs, and once on `run.py sync`, `rsync` over SSH copies new turns. A turn with a
clean question and a reply is filed like a desktop exchange and tagged `rover`; `filed.json` stops a
second filing. When the laptop is off, the rover keeps answering and the next pass catches up.

## Shared core

`src/beaver/core`, installed as the `beaver` package:

| Module | Role |
|---|---|
| `settings.py` | Loads an app's `config.toml` and `--set` overrides; fills prompt placeholders |
| `record.py` | One run folder per turn |
| `gemini.py` | Gemini requests with text, audio, or image parts, JSON replies, and retries |
| `speech.py` | ElevenLabs speech; refuses text over `elevenlabs.max_characters` before sending |
| `guard.py` | The guard proxy's replacements and length check |
| `transcribe.py` | Whisper base transcription and language detection |
| `languages.py` | The phone page's eight languages, by code and English name |
| `prompts/` | Shared prompts; an app's own `prompts/` folder is searched first |

## Security

| Surface | Rule |
|---|---|
| API keys | Only in `.env` on each machine; never in a browser, record, or log |
| Desktop page | Listens on 127.0.0.1; serves audio only from its `runs/` folder; caps requests at 15 MB |
| Phone page | Answers only requests with the current start's token |
| Sync | Uses the laptop's SSH key; opens no port on either machine |
