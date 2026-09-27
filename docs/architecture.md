# Architecture

Beaver has one person, one rover, and one desktop app. The rover answers questions on its own and
never waits on the laptop; the laptop collects what the rover heard and keeps every notebook.

## Rover

The rover runs `src/beaver/rover/run.py` on a Raspberry Pi 5. Its hardware has a camera and a
speaker but no microphone (see [hardware.md](hardware.md)), so questions arrive from a phone:

1. `run.py phone` starts a web server on port 8770 and a Cloudflare quick tunnel to it, then prints
   the page's HTTPS address and a QR code of it in the terminal. The address carries a random token
   that changes at every start; the server answers 403 to any request without it.
2. The person holds the button on the phone page while asking. The browser records the phone's
   microphone, converts it to 16 kHz mono WAV, and uploads it through the tunnel.
3. The rover takes a camera frame, sends the question audio and the frame to Gemini with the shared
   system prompt, returns the reply text to the phone, and speaks it through ElevenLabs on its
   speaker. It answers one question at a time.

The tunnel exists because phone browsers open the microphone only on HTTPS pages, and because
eduroam blocks connections between devices on the same network. A quick tunnel connects outward
over port 443 and needs no Cloudflare account.

Every turn saves a folder under `src/beaver/rover/runs/` on the Pi: `record.json` (the config used,
everything sent to Gemini and ElevenLabs, the reply, token counts, and timings), `question.wav`,
`frame.jpg`, and `reply.wav`. These folders are the rover's outbox for sync.

## Desktop app

The desktop app runs `src/beaver/desktop/run.py serve`, a local web page at
`http://127.0.0.1:8765`. It takes a question by voice or typing, with an optional frame from the
laptop camera, and answers sentence by sentence in English, French, or both, optionally adding the
visitor's own language to each sentence. After each answer, one Gemini request files the exchange
into a notebook: a title in English and French, a theme, a span of years, vocabulary in three
languages, concepts, and dated moments. All notebooks live in one file,
`src/beaver/desktop/notebooks/notebooks.json`, which git ignores.

## Sync

The desktop app pulls the rover's turns; the rover never pushes. The Pi reaches the internet and the
laptop reaches the Pi over SSH through Tailscale, but a test TCP connection from the Pi to the laptop
failed, so the connection runs laptop to Pi.

- Every 60 seconds while `serve` runs, and once on `run.py sync`, `rsync` over SSH copies each new
  run folder's `record.json`, `question.wav`, and `frame.jpg` into
  `src/beaver/desktop/rover-runs/` (gitignored). No port opens on either machine.
- A turn with question audio, a reply, and no error is filed: one Gemini request writes down the
  spoken question and names its language, then the same notebook filing as the desktop's own
  exchanges runs, marking the entry `source: "rover"`. The notebook view tags those entries `rover`.
- A `filed.json` marker in each pulled folder keeps a turn from being filed twice. When the laptop
  is off or the Pi is unreachable, the rover keeps answering and the next pass catches up.

## Shared core

`src/beaver/core` holds the modules both apps use, installed as the `beaver` package:

| Module | Role |
|---|---|
| `settings.py` | Loads an app's `config.toml`, applies `--set section.key=value` overrides, records the app's folder, and fills prompt placeholders from `[prompt_vars]` |
| `record.py` | One run folder per turn, under the app's own `runs/` |
| `gemini.py` | Gemini requests with text, audio, or image parts, optional JSON-schema replies, a label per call for timings and tokens, and retries on server errors |
| `speech.py` | ElevenLabs text to speech; refuses text over `elevenlabs.max_characters` before anything is sent or logged |
| `prompts/` | The system, look, text, and typed-question prompts; an app's own `prompts/` folder is searched first |

The system prompt asks for at most 3 sentences, each one idea under 20 words, with years and
numbers written as digits.

## Guard

`src/beaver/rover/guard.py` finds personal information (emails, phone numbers, postal codes,
addresses, social insurance numbers, Quebec and Ontario health card numbers, and payment card
numbers) and over-long text, replaces findings with a spoken phrase such as "a phone number", and
cuts text at a sentence end. It runs entirely on the Pi. The rover does not call it yet: the next
part transcribes the phone's audio on the Pi, so the guard can redact a question before any of it
reaches Gemini, and then checks every reply before it is spoken or saved.

## Security

- The Gemini and ElevenLabs keys live only in `.env` at the repo root on each machine and never
  reach a browser, a record, or a log.
- The desktop page listens on 127.0.0.1 only, serves audio only from inside its `runs/` folder,
  accepts only its listed settings and values, and caps requests at 15 MB.
- The phone page answers only requests carrying the token from its current start.
- Sync uses the laptop's existing SSH key for the Pi and opens no port.
