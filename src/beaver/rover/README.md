# Experiment 002: the voice and camera loop on a Raspberry Pi 5

| | |
|---|---|
| Status | Active |
| Started | 2026-09-26 |
| Builds on | [Experiment 001](../desktop/README.md) |
| Ticket | [#2](https://github.com/reversely/beaver/issues/2) |

This folder is a sandbox experiment. Code in `src/beaver/` never imports from it. It copies
`settings.py`, `record.py`, `gemini.py`, `speech.py`, and four prompts from experiment 001 unchanged,
so each experiment stays a complete record of what ran.

## Question

Can a Raspberry Pi 5 with an I2S microphone, an I2S speaker amplifier, and an OV5647 camera module
wait for a wake word or a button, hear a question, see what is in front of it, and speak Gemini's
answer through ElevenLabs? How long does each step take, and how much CPU does the wake word cost
while the rover waits?

## Hardware

| Part | Connection |
|---|---|
| Raspberry Pi 5 | Raspberry Pi OS 64-bit, based on Debian 13 (trixie), Python 3.13 |
| OV5647 camera module (5 MP) | Camera connector; the Pi 5 uses the narrow 22-pin connector, so a 15-pin module needs the Pi 5 adapter cable |
| I2S MEMS microphone | Data out to GPIO 20 |
| I2S speaker amplifier | Data in from GPIO 21 |
| Push-to-talk button | Between GPIO 25 and ground |

The microphone and the amplifier also share the I2S clocks: bit clock on GPIO 18 and word select on
GPIO 19. A MEMS microphone with an L/R pin sends its signal on the left channel (channel 0) when
L/R connects to ground, and on the right channel (channel 1) when it connects to 3.3 V.

## Setup on the Pi

1. Copy the repo to the Pi, including `.env`, which holds the API keys. From the laptop:
   ```
   rsync -av --exclude .venv --exclude .git --exclude 'runs/' ~/Repos/beaver/ <user>@<pi-host>:~/beaver/
   ```
2. On the Pi, from `~/beaver`:
   ```
   bash src/beaver/rover/setup-pi.sh
   ```
   The script installs `python3-picamera2`, `python3-gpiozero`, `python3-lgpio`, and
   `libportaudio2` with apt, creates the venv with `--system-site-packages` so it can import them,
   installs the `pi` dependency group, and downloads the wake word models.
3. Enable I2S audio in `/boot/firmware/config.txt` and reboot:
   ```
   dtparam=i2s=on
   dtoverlay=googlevoicehat-soundcard
   ```
   `googlevoicehat-soundcard` drives an I2S microphone and amplifier on GPIO 18 to 21 together.
   Other overlays exist for specific boards; `arecord -l` and `aplay -l` confirm whether the chosen
   overlay created a capture and a playback device.

## Bring-up order

Each command tests one part before the full loop depends on it. All commands run as
`uv run --group pi python src/beaver/rover/run.py <command>`.

| Command | What it checks |
|---|---|
| `devices` | Lists sound devices and cameras. Put part of the I2S card's name in `microphone.device` and `speaker.device`. |
| `speak` | ElevenLabs speech through the amplifier. |
| `snap` | Saves one OV5647 frame to a run folder. |
| `mictest` | Records 5 seconds; stay quiet, then speak. Prints each channel's raw peak, so `microphone.channel` can point at the loud one, and the quiet and loud levels after gain, so `endpoint.silence_dbfs` can sit between them. Saves the audio. |
| `wakewordtest` | Listens for 30 seconds, prints each detection and its score, and reports milliseconds per 80 ms frame and the process CPU use. |
| `text` | A typed question to Gemini, which checks the Gemini key on the Pi. |
| `look "What is this?"` | One turn with a typed question and a camera frame. |
| `look` | One turn with a trigger and a spoken question. |
| `loop` | Answers questions until Ctrl-C. |
| `phone` | Answers questions spoken into a visitor's phone; see below. |

## Triggers

`trigger.modes` lists the active triggers, and the rover checks each one every 80 ms.

- `wakeword`: openWakeWord listens on the Pi and sends nothing anywhere until it detects the wake
  word. A chime plays, and the rover records until the visitor has been quiet for
  `endpoint.silence_seconds`.
- `button`: the rover records while the GPIO 25 button is held and stops on release.
- `enter`: Enter starts and stops recording, for testing over SSH.

openWakeWord ships no "hey beaver" model. `wakeword.model = "hey_jarvis"` stands in until a custom
model is trained with the openWakeWord training notebook. A trained `.onnx` file placed in this
folder loads through `wakeword.model = "hey_beaver.onnx"`.

openWakeWord's authors report that "a single core of a Raspberry Pi 3 can run 15-20 openWakeWord
models simultaneously in real-time". `wakewordtest` measures the cost on this Pi 5.

## The phone as the microphone

`run.py phone` lets a visitor ask questions through the browser on their own phone. The Pi's
built-in Bluetooth pairs with headsets such as AirPods Max but delivers no microphone audio, so
the phone's microphone stands in for one.

1. The Pi starts a web server on `phone.port` and a Cloudflare quick tunnel to it, then prints a
   QR code and an HTTPS address in the terminal. The address holds a random session token; the
   server answers 403 to any request without it, and a new token replaces it at every start.
2. The visitor scans the code and holds the button on the page while asking the question. The
   browser records the microphone, converts the recording to 16 kHz mono WAV, and uploads it.
3. The Pi captures a camera frame, sends the audio and the frame to Gemini, returns the reply text
   to the phone, and speaks the reply through the rover's speaker. It answers one question at a
   time and tells a second phone to wait.

A quick tunnel needs no Cloudflare account and connects outward over TCP 443, so it works on
eduroam, which blocks connections between devices. Its address changes at every start. In one of
three tests, eduroam's DNS servers had not resolved a new `trycloudflare.com` address two minutes
after 1.1.1.1 did, so a phone on mobile data gives the more dependable test.

### Phone hotspot

Without a tunnel, the Pi and the phone join the phone's hotspot, and the Pi serves HTTPS itself,
because phone browsers only open the microphone on HTTPS pages. On the Pi, from this folder:

```
nmcli device wifi connect "<hotspot name>" password "<hotspot password>"
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=beaver" \
  -keyout phone-key.pem -out phone-cert.pem
uv run --group pi python run.py phone --set phone.tunnel=none \
  --set phone.certfile=phone-cert.pem --set phone.keyfile=phone-key.pem
```

The certificate is self-signed, so the phone shows a warning the first time; "Show Details",
then "visit this website" on iPhone, or "Advanced", then "Proceed" on Android, opens the page.
Git ignores `*.pem` files.

## Configuration and prompts

`config.toml` holds every setting with a comment on each, and `--set section.key=value` overrides
one value for one run. Two defaults differ from experiment 001, based on its results:

- `gemini.model = "gemini-3.5-flash-lite"`, because `gemini-3.8-flash` stopped at a free-tier cap of
  20 requests.
- `gemini.media_resolution = "low"`, which costs 260 image tokens against 1080 at the model default.

`speaker.enable_pin` names the GPIO pin that powers the amplifier. The Robot HAT v4 powers its
speaker only while GPIO 20 is high, so every command drives that pin high before it plays audio.

The prompts in `prompts/` are unchanged copies from experiment 001. Each turn prints what it sends
to Gemini and ElevenLabs and saves a run folder under `runs/` (gitignored) with `record.json`, the
question audio, the camera frame, and the spoken reply.

## Guard

`guard.py` checks text for personal information and length, entirely on the Pi. It is the first
part of the rover guard (plan: shorten long messages and redact personal information before
anything leaves the Pi); the rover does not call it yet.

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

Names are not covered: a pattern cannot tell a visitor's name from a historical figure's. The
tests include answers full of years and dates that must pass unchanged:

```
uv run python -m unittest discover -s src/beaver/rover/tests
```

## Dependencies

The `pi` dependency group holds this experiment's pip packages. openWakeWord requires
`tflite-runtime` on Linux, which has no Python 3.13 builds, so `pyproject.toml` overrides that
requirement away, and this experiment runs openWakeWord on onnxruntime.

## Results

| Test | Where | Setting | Measurement |
|---|---|---|---|
| Resampling, synthetic tones | Laptop | 48 kHz int32 stereo to 16 kHz | 1 kHz tone kept at -9.0 dBFS; 20 kHz tone reduced to -73.1 dBFS |
| `look "What is this?"` | Laptop | Lucky Loonie photo, speaker off | Gemini 1.9 s, ElevenLabs first audio 3.8 s, question end to speech 6.0 s; prompt 580 tokens (text 320, image 260) |
| `wakewordtest` | Laptop | `hey_jarvis`, built-in microphone, 10 s | 4.4 ms per 80 ms frame; process CPU 11% of one core |
| `phone`, question from the laptop through the tunnel | Pi 5 | 1.7 s spoken question (macOS `say`), five dollar bill in front of the camera | Upload read 3 ms, camera 61 ms, Gemini 2018 ms, ElevenLabs first audio 3133 ms, question end to speech 5.4 s; reply text reached the caller 2.3 s after upload; prompt 619 tokens (image 266, text 311, audio 42) |
| The other commands | Pi 5 | | Not yet recorded here |

Observations:

- The laptop `look` reply placed the Lucky Loonie at "the nineteen ninety six Salt Lake City
  Olympics". The Salt Lake City Games took place in 2002, which `gemini-3.5-flash-lite` stated
  correctly in the experiment 001 image test. This is the second wrong date from Flash-Lite across
  the two experiments.
