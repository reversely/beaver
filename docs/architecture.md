# Architecture

Beaver serves a newcomer to Canada: a person newly arrived from abroad who wants to know how things
work here and to hear it in English, French, and their own language. It meets them in two places.
Out in the city, the rover answers a question about what they see, asked from their phone. At the laptop, the desktop app answers their longer questions and keeps every exchange, from
either place, as notebooks of the vocabulary, concepts, and dates each question taught.

![Parts of Beaver: on the rover, local processing puts a guard proxy between the rover and the remote AI services; the proxy sends Gemini clean text and a photo and sends ElevenLabs the checked answer; the desktop app sends Gemini and ElevenLabs its own questions and copies each saved rover turn over SSH every 60 seconds](img/how-it-works-parts.svg)

## Rover

The rover lets the newcomer ask about a landmark, a coin, or a dish on the spot: its camera sees
what they see, and it answers aloud in their language, moving the mouth on its
screen as it speaks.

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
   sentence end if it runs over the ElevenLabs limit, returns it to the phone, and speaks it through
   ElevenLabs on its speaker. It answers one question at a time.

Phone browsers open the microphone only on HTTPS pages, and eduroam blocks connections between
devices on the same network, so the phone page runs through a tunnel. A quick tunnel connects outward
over port 443 and needs no Cloudflare account.

Every turn saves a folder under `src/beaver/rover/runs/` on the Pi: `record.json` (the config used,
everything sent to Gemini and ElevenLabs, the reply, token counts, and timings), `question.wav`,
`frame.jpg`, and `reply.wav`. Sync copies the rover's turns from these folders.

## Desktop app

The desktop app serves the same newcomer at the laptop, where they can type or speak a longer
question, read the answer sentence by sentence in both official languages and their own, and go back
over what each question taught.

The desktop app runs `src/beaver/desktop/run.py serve`, which serves the demo at
`http://127.0.0.1:8765` and the app's page at `/app/`. Its Rover panel starts the rover's phone page
over SSH and shows the address and QR code. The app takes a question by voice or typing, with an optional frame from the
laptop camera, transcribes and guards it on the laptop (see Guard proxy), and answers sentence by sentence in English, French, or both, optionally adding the
visitor's own language to each sentence. After each answer, one Gemini request files the exchange
into a notebook: a title in English and French, a theme, a span of years, vocabulary in three
languages, concepts, and dated moments. All notebooks live in one file,
`src/beaver/desktop/notebooks/notebooks.json`, which git ignores.

## Sync

Sync puts every question the newcomer asks the rover into their notebooks on the laptop.

The desktop app pulls the rover's turns; the rover never pushes. The Pi reaches the internet and the
laptop reaches the Pi over SSH through Tailscale, but a test TCP connection from the Pi to the laptop
failed, so the connection runs laptop to Pi.

- Every 60 seconds while `serve` runs, and once on `run.py sync`, `rsync` over SSH copies each new
  run folder's `record.json` and `frame.jpg` into `src/beaver/desktop/rover-runs/` (gitignored).
  No port opens on either machine.
- The desktop app files a turn with a redacted question, a language, a reply, and no error from
  its `record.json`, with the same notebook filing as its own exchanges, marking the entry
  `source: "rover"`. The notebook view tags those entries `rover`. The question audio stays on the
  Pi. The desktop app skips a turn where the rover asked the visitor to choose a language or ask again.
- A turn saved before on-board transcription has no redacted question, so the sync also pulls its
  `question.wav`, and one Gemini request writes down the question and names its language.
- A `filed.json` marker in each pulled folder keeps the desktop app from filing a turn twice. When
  the desktop app is closed or cannot reach the Pi, the next pass catches up.

## Shared core

The shared core gives the rover and the desktop app one way to ask Gemini and ElevenLabs, with the
same prompts, so the newcomer gets the same kind of answer in both places.

`src/beaver/core` holds the modules both apps use, installed as the `beaver` package:

| Module | Role |
|---|---|
| `settings.py` | Loads an app's `config.toml`, applies `--set section.key=value` overrides, records the app's folder, and fills prompt placeholders from `[prompt_vars]` |
| `record.py` | One run folder per turn, under the app's own `runs/` |
| `gemini.py` | Gemini requests with text, audio, or image parts, optional JSON-schema replies, a label per call for timings and tokens, and retries on server errors |
| `speech.py` | ElevenLabs text to speech; refuses text over `elevenlabs.max_characters` before sending or logging anything |
| `prompts/` | The system, look, text, and typed-question prompts; `settings.py` looks in an app's own `prompts/` folder first |

The system prompt asks for at most 3 sentences, each one idea under 20 words, with years and
numbers written as digits.

## Guard proxy

The guard proxy protects the newcomer's personal information. Questions about duties, documents, and
deadlines can carry a phone number, an address, or a card number, and the guard proxy keeps those
from reaching the AI services.

![Guard proxy: the recording stays on the rover; Whisper transcribes it and the guard proxy replaces personal information, so Gemini receives clean text and a photo; the proxy checks the answer before ElevenLabs converts it into speech](img/how-it-works-privacy.svg)

`src/beaver/core/guard.py` finds personal information (emails, phone numbers, postal codes,
addresses, social insurance numbers, Quebec and Ontario health card numbers, and payment card
numbers) and over-long text, replaces findings with a spoken phrase such as "a phone number", and
cuts text at a sentence end. It runs on the machine that heard the question: on the Pi for every
phone turn, and on the laptop for every question asked in the desktop app. It runs on the
transcript before Gemini receives it, and on the reply before the app speaks or saves it. The run record
keeps the redacted question, the chosen language, and which rules fired, never the unredacted text.

Both apps transcribe a spoken question with `src/beaver/core/transcribe.py` (Whisper base) before
the guard sees it, so Gemini receives text and never audio. The desktop app detects the language
among the rover's eight and asks the visitor to ask again or type when Whisper scores the language under 0.7.

The rover still saves the question audio (`question.wav`) in its run folder on the Pi; the desktop
app files the redacted transcript and never pulls that audio.

## Security

These rules keep the API keys, the newcomer's recordings, and the rover's phone page away from
anyone else on the same network or the internet.

- The Gemini and ElevenLabs keys live only in `.env` at the repo root on each machine and never
  reach a browser, a record, or a log.
- The desktop page listens on 127.0.0.1 only, serves audio only from inside its `runs/` folder,
  accepts only its listed settings and values, and caps requests at 15 MB.
- The phone page answers only requests carrying the token from its current start.
- Sync uses the laptop's existing SSH key for the Pi and opens no port.
