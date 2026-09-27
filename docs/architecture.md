# Architecture

Beaver has one person, one rover, and one desktop app. The rover answers questions on its own and
never waits on the laptop; the laptop collects what the rover heard and keeps every notebook.

## Rover

The rover runs `src/beaver/rover/run.py` on a Raspberry Pi 5. Its hardware has a camera and a
speaker but no microphone (see [hardware.md](hardware.md)), so questions arrive from a phone:

1. `run.py phone` starts a web server on port 8770 and a Cloudflare quick tunnel to it, then prints
   the page's HTTPS address and a QR code of it in the terminal. The address carries a random token
   that changes at every start; the server answers 403 to any request without it.
2. The person picks their language on the phone page (English, French, Spanish, Arabic, Chinese,
   Punjabi, Tagalog, or Ukrainian) and holds the button while asking. The browser records the
   phone's microphone, converts it to 16 kHz mono WAV, and uploads it through the tunnel with the
   language. The rover accepts only a language from its fixed list.
3. The rover transcribes the question on the Pi with Whisper base in that language, and the guard
   redacts personal information from the transcript. The rover takes a camera frame and sends
   Gemini the redacted text and the frame, never the audio. It redacts the reply, shortens it at a
   sentence end if it is over the ElevenLabs limit, returns it to the phone, and speaks it through
   ElevenLabs on its speaker. It answers one question at a time.

The tunnel exists because phone browsers open the microphone only on HTTPS pages, and because
eduroam blocks connections between devices on the same network. A quick tunnel connects outward
over port 443 and needs no Cloudflare account.

Every turn saves a folder under `src/beaver/rover/runs/` on the Pi: `record.json` (the config used,
everything sent to Gemini and ElevenLabs, the reply, token counts, and timings), `question.wav`,
`frame.jpg`, and `reply.wav`. These folders are the rover's outbox for sync.

## Desktop app

The desktop app runs `src/beaver/desktop/run.py serve`, which serves the demo at
`http://127.0.0.1:8765` and the app's page at `/app/`. Its Rover panel starts the rover's phone page
over SSH and shows the address and QR code. The app takes a question by voice or typing, with an optional frame from the
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
  run folder's `record.json` and `frame.jpg` into `src/beaver/desktop/rover-runs/` (gitignored).
  No port opens on either machine.
- A turn with a redacted question, a language, a reply, and no error is filed from its
  `record.json`, with the same notebook filing as the desktop's own exchanges, marking the entry
  `source: "rover"`. The notebook view tags those entries `rover`. The question audio stays on the
  Pi. A turn where the rover asked the visitor to choose a language or ask again is not filed.
- A turn saved before on-board transcription has no redacted question, so the sync also pulls its
  `question.wav`, and one Gemini request writes down the question and names its language.
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
cuts text at a sentence end. It runs entirely on the Pi, on every phone turn: on the transcript
before Gemini receives it, and on the reply before it is spoken or saved. The run record keeps the
redacted question, the chosen language, and which rules fired, never the unredacted text.

The rover still saves the question audio (`question.wav`) in its run folder on the Pi; the desktop
app files the redacted transcript and never pulls that audio.

## Security

- The Gemini and ElevenLabs keys live only in `.env` at the repo root on each machine and never
  reach a browser, a record, or a log.
- The desktop page listens on 127.0.0.1 only, serves audio only from inside its `runs/` folder,
  accepts only its listed settings and values, and caps requests at 15 MB.
- The phone page answers only requests carrying the token from its current start.
- Sync uses the laptop's existing SSH key for the Pi and opens no port.
