# Rover

The rover runs on a Raspberry Pi 5 in a SunFounder PiCar-X. A person asks a question through the
phone page, the rover looks through its camera, asks Gemini, and speaks the answer on its speaker
through ElevenLabs. Its hardware, power, and network access are in
[docs/hardware.md](../../../docs/hardware.md); how it connects to the desktop app is in
[docs/architecture.md](../../../docs/architecture.md).

## Setup

From the laptop, copy the repo (including `.env`, which holds the API keys) to the Pi, then run the
setup script there:

```
rsync -av --exclude .venv --exclude .git --exclude 'runs/' ~/Repos/beaver/ pi@100.99.246.84:~/beaver/
ssh pi@100.99.246.84 'cd ~/beaver && bash src/beaver/rover/setup-pi.sh'
```

The script installs `picamera2`, `gpiozero`, `lgpio`, and PortAudio with apt, creates the
environment with `--system-site-packages` so it can import them, installs the `rover` dependency
group, installs `cloudflared`, and downloads the wake word models.

## Commands

All commands run on the Pi from `~/beaver`:

```
uv run --group rover python src/beaver/rover/run.py <command> [words] [--set section.key=value]
```

| Command | What it does |
|---|---|
| `phone` | Takes questions from the phone page and answers through the rover's camera and speaker |
| `text` | Sends a typed question to Gemini and prints the reply, which checks the Gemini key |
| `speak` | Speaks text through ElevenLabs on the rover's speaker |
| `snap` | Saves one camera frame to a run folder |
| `look "What is this?"` | One turn with a typed question and a camera frame |
| `devices` | Lists sound devices and cameras |
| `usage` | Prints the ElevenLabs characters used and remaining |
| `look`, `loop`, `mictest`, `wakewordtest` | Take questions from a microphone on the Pi; the Robot HAT v4 has none, so these wait for one to be added |

## The phone as the microphone

`run.py phone` starts a web server on `phone.port` (8770) and a Cloudflare quick tunnel to it, then
prints the page's HTTPS address and a QR code of it in the terminal. The address carries a random
token; the server answers 403 to any request without it, and a new token replaces it at every start.

The person opens the page on a phone, picks their language or leaves it on "Detect
automatically", and holds the button while asking. The browser records the phone's microphone,
converts it to 16 kHz mono WAV, and uploads it with the choice, which the phone remembers for next
time. The rover transcribes the question on the Pi, redacts it, sends Gemini the redacted text with
a camera frame, returns the reply text to the phone, and speaks the reply. A choice outside the
page's list gets a 400. For automatic detection, Whisper base detects the language among the page's
eight and transcribes in one pass; under `transcribe.detect_min_probability` (0.7) the rover asks
the visitor to choose a language and sends nothing to Gemini. Tiny detects faster but heard a real
Chinese question as English with 0.79 (docs/measurements.md).
It answers one question at a time and tells a second phone to wait.

The server also writes the page's address to `phone-address.txt` (mode 600, gitignored) and
removes it on exit, for the desktop app's Rover panel, which starts and stops the server over SSH
and ends it with SIGTERM. `phone.print_address = false` leaves the address and QR code out of the
terminal output.

"Use my location" appears only on HTTPS pages, where browsers offer geolocation. A tap reads the
phone's position once, rounds it to 2 decimals (about 1 km), and posts it to `/api/location` with
the same token; the rover rounds again, refuses anything but two in-range numbers (400) or a body
over 128 bytes (413), and writes the rounded pair into each later turn's `record.json` as
`location`. The rover uses it for nothing else; mapping it to a province and municipality is the
desktop's job (#31).

A quick tunnel needs no Cloudflare account and connects outward over port 443, so it works on
eduroam, which blocks connections between devices. Its address changes at every start. In one of
three tests, eduroam's DNS had not resolved a new `trycloudflare.com` address two minutes after
1.1.1.1 did, so a phone on mobile data gives the more dependable connection.

### Without a tunnel

The Pi and the phone can instead join the phone's hotspot, with the Pi serving HTTPS itself,
because phone browsers open the microphone only on HTTPS pages. On the Pi, from this folder:

```
nmcli device wifi connect "<hotspot name>" password "<hotspot password>"
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=beaver" \
  -keyout phone-key.pem -out phone-cert.pem
uv run --group rover python run.py phone --set phone.tunnel=none \
  --set phone.certfile=phone-cert.pem --set phone.keyfile=phone-key.pem
```

The certificate is self-signed, so the phone warns the first time: "Show Details", then "visit this
website" on iPhone, or "Advanced", then "Proceed" on Android, opens the page. Git ignores `*.pem`.

## Triggers

With a microphone on the Pi, `trigger.modes` lists how a question starts, checked every 80 ms:

- `wakeword`: openWakeWord listens on the Pi and sends nothing anywhere until it hears the wake
  word, then records until the speaker has been quiet for `endpoint.silence_seconds`. No
  "hey beaver" model exists yet, so `wakeword.model = "hey_jarvis"` stands in; a trained `.onnx`
  file in this folder loads through `wakeword.model = "hey_beaver.onnx"`.
- `button`: records while the HAT's USER button (GPIO 25) is held.
- `enter`: Enter starts and stops recording, for testing over SSH.

## Guard

`beaver.core.guard` checks text for personal information and length, on the Pi. Every phone turn
transcribes the question on the Pi (`beaver.core.transcribe`, Whisper base in the language the phone page
sends or detects), redacts the transcript before Gemini sees it, and redacts and, if needed, shortens the
reply before it is spoken or saved. `[transcribe]` in `config.toml` sets the model, precision, and
threads.

- `check(text)` lists findings by rule and position and never holds the matched text.
- `redact(text)` replaces each finding with a spoken phrase, such as "a phone number".
- `shorten(text, limit)` cuts at the last sentence end within the limit, including Chinese and
  Japanese full stops, and reports the share of text it dropped.

| Rule | Matches | Check |
|---|---|---|
| `email` | `name@example.ca` | |
| `health_card_qc` | Quebec RAMQ: four letters, eight digits | |
| `health_card_on` | Ontario: ten digits as 4-3-3, optional version code | Luhn |
| `payment_card` | 13 to 19 digits, unbroken or in groups of four | Luhn; a run of four-digit years is not a card |
| `social_insurance` | nine digits as 3-3-3 | Luhn; never starts with 0 or 8 |
| `phone` | North American numbers with an optional +1, international numbers with + | |
| `postal_code` | `K1A 0A9` | |
| `address` | "221 Rideau Street", "1234 rue Sainte-Catherine" | |

Names are not covered: a pattern cannot tell a visitor's name from a historical figure's.

```
uv run python -m unittest discover -s src/beaver/rover/tests
```

## Configuration

`config.toml` holds every setting with a comment on each, and `--set section.key=value` overrides
one value for one run. The rover uses `gemini-3.5-flash-lite`, because `gemini-3.8-flash` stopped
at a free-tier cap of 20 requests in desktop testing, and sends images at `low` resolution (260
image tokens against 1080 at the model default). `speaker.enable_pin = 20` raises the HAT's
amplifier enable pin before every playback. The rover's prompts all come from
`src/beaver/core/prompts/`.

Each turn prints what it sends to Gemini and ElevenLabs and saves a folder under `runs/`
(gitignored) with `record.json`, the question audio, the camera frame, and the spoken reply. The
desktop app pulls these folders to file the rover's turns into its notebooks.

openWakeWord requires `tflite-runtime` on Linux, which has no Python 3.13 builds, so
`pyproject.toml` overrides that requirement away and openWakeWord runs on onnxruntime.
