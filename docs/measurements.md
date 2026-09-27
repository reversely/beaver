# Measurements

Every value here was measured on 2026-09-26 or 2026-09-27, on the MacBook (Apple A18 Pro) unless
the row says Pi 5, with each app's default `config.toml` unless noted.

## Desktop app

| Command | Setting | Measurement |
|---|---|---|
| `text` | `gemini-3.8-flash`, thinking `low` | Gemini reply in 10.4, 1.2, 3.2, 9.9, and 3.4 s over five runs |
| `text` | `gemini-3.5-flash-lite` | Gemini reply in 1.0 s over one run |
| `text` | `gemini-3.8-flash`, thinking `minimal` | Rejected: the model does not support `minimal` |
| `speak` | `eleven_multilingual_v2`, 58 characters | First audio at 1.6 s, full audio at 1.7 s, 4.0 s of playback |
| `speak` | "Bienvenue au Canada. Welcome to Canada.", 3 runs | First audio at 1.2, 1.3, and 6.3 s |
| `voice` | `gemini-3.8-flash`, 4.5 s question | Gemini 29.3 s, first audio 10.6 s |
| `voice` | `gemini-3.8-flash`, 2.1 s question | Gemini 1.6 s, first audio 1.9 s; the audio cost 52 prompt tokens |
| `bilingualtest` | `gemini` translation, 3 cases, playback off | Translation 1,060 to 1,341 ms; first audio 4.3 to 7.3 s; peak memory 87 MB |
| `bilingualtest` | `argos` translation, 3 cases, playback off | Translation 385 to 481 ms; first audio 3.6 to 4.3 s; peak memory 220 MB; 206 to 252 fewer Gemini tokens per case |
| Argos alone | 3 sentences, int8, 2 threads | 143 to 188 ms warm per language; 300 to 1,200 ms to load a model; about 150 MB per loaded model |
| Typed question through the page's API | Before the shared-core merge, 2 runs | First audio at 2.68 and 2.32 s |
| Typed question through the page's API | After the shared-core merge, 7 runs | First audio at 2.36 to 3.00 s, averaging 2.65 s |
| 3D pieces | 8 pieces at 200 px, headless Chrome | 223 ms on a cold start, 96 ms on a second run; the first piece takes 74 ms for WebGL setup and the rest 1 to 8 ms each |

Observations:

- `gemini-3.8-flash` reply times varied tenfold across identical requests, so a single timing does
  not characterize it.
- ElevenLabs first audio usually arrived in 1.2 to 1.9 s, with two runs at 6.3 and 10.6 s.
- A spoken question costs about 25 audio tokens per second.
- One `gemini-3.5-flash-lite` reply to "Why does Canada have two official languages?" placed
  official recognition in the 1700s; its four image-test replies all gave 1969. The Official
  Languages Act passed in 1969, which the `gemini-3.8-flash` reply stated.

## Translation backends

Gemini wrote each English answer; the two backends then translated it. The Gemini translations kept
the English name in brackets, as in "برج السلام (Peace Tower)". The Argos translations carried
these errors:

- Arabic: "Parliament Hill" became "البرلمان هيل", keeping "Hill" as a sound, and "Centre Block"
  became "مركز "بلوك"".
- Spanish: "nineteen seventeen" became "diecinueve y diecisiete años", and "wilderness" became
  "desierto", which means desert.
- Traditional Chinese: the first sentence lost its second half, "cheese" doubled as "奶酪奶酪", and
  Simplified forms such as "制成" appeared.
- Swahili: "fresh cheese curds topped with warm brown gravy" became "curds safi cheese kuchorea na
  gravy joto kahawia", leaving English words in place.

Sentence-level translation models read a spelled-out year such as "nineteen seventeen" as words. The
system prompt then changed to ask for years and numbers as digits and for sentences under 20 words.
Rerun on Argos, the same three cases produced sentences of 8 to 11 words, answers of 205 to 327
characters (down from 296 to 599), first audio in 2.7 to 3.8 s, and a correct Spanish year
("en 1916"). The Arabic "البرلمان هيل" and the doubled Chinese "奶酪奶酪" remained.

## Camera images

Five typed questions went to `gemini-3.5-flash-lite` with a photo of the Lucky Loonie display, once
each with no image and with the image at `low`, `default`, and `high` media resolution. A partial
run on `gemini-3.8-flash` produced identical token counts.

| Image | Image tokens | Prompt tokens | Increase over no image |
|---|---|---|---|
| none | 0 | 320 to 328 | |
| low | 260 | 580 to 588 | 1.8 times |
| default | 1080 | 1400 to 1408 | 4.4 times |
| high | 1080 | 1400 to 1408 | 4.4 times |

- The default resolution cost the same 1080 tokens as `high`. The rover sends images at `low`;
  the desktop app leaves `gemini.media_resolution` empty, which uses the model's default.
- Reply tokens stayed between 38 and 75. Thinking tokens appeared in 3 of 20 requests, at 482 to
  614 tokens each.
- Questions unrelated to the image never mentioned it, as `prompts/look.md` instructs.
- "What is this?" with no image produced an invented scene ("a classic red Canadian post box"),
  because the prompts then said an image was attached even when none was.
- The `low` replies named the Lucky Loonie and the 2002 Salt Lake City Olympics; the `default` and
  `high` replies described a hockey faceoff. Each variant ran once at temperature 0.7, so this does
  not establish that lower resolution identifies better.

## Rover

| Test | Where | Setting | Measurement |
|---|---|---|---|
| Resampling, synthetic tones | Laptop | 48 kHz int32 stereo to 16 kHz | 1 kHz tone kept at -9.0 dBFS; 20 kHz tone reduced to -73.1 dBFS |
| `look "What is this?"` | Laptop | Lucky Loonie photo, speaker off | Gemini 1.9 s, ElevenLabs first audio 3.8 s, question end to speech 6.0 s; prompt 580 tokens (text 320, image 260) |
| `wakewordtest` | Laptop | `hey_jarvis`, built-in microphone, 10 s | 4.4 ms per 80 ms frame; 11% of one core |
| `text` | Pi 5 | "Why does Canada have two official languages?" | Gemini 2.5 s; 190 prompt tokens |
| `speak` | Pi 5 | 58 characters, battery charged | ElevenLabs first audio 1.1 to 1.2 s, 3.5 s of playback |
| `snap` | Pi 5 | OV5647 | 21 ms per frame |
| `phone`, question sent through the tunnel from the laptop | Pi 5 | 1.7 s spoken question, a five-dollar bill in front of the camera | Upload read 3 ms, camera 61 ms, Gemini 2018 ms, ElevenLabs first audio 3133 ms, question end to speech 5.4 s; the reply text reached the caller 2.3 s after upload; prompt 619 tokens (image 266, text 311, audio 42) |
| Guard | Laptop | `redact` on a 620-character reply | Under 5 ms per call |

The rover's `look` reply on the laptop placed the Lucky Loonie at "the 1996 Salt Lake City
Olympics"; those Games took place in 2002, which the same model stated correctly in the desktop
image test.

## On-board transcription

faster-whisper 1.2.1 with int8 weights on the Pi 5, two threads at `nice -n 19`, on HAT battery with
no fan, transcribing the rover's four recorded phone questions (1.7 to 6.8 s of audio). Each time
covers one question, after the model loaded.

| Model | Load | Time per question | English questions | Chinese question ("你可以帮我介绍一下Emily Carr") |
|---|---|---|---|---|
| tiny | 1.8 s | 1.7 s | Correct, "Emily Carre" | Heard as English: "You can just follow me on social media.com" |
| base | 2.3 s | 3.2 to 3.4 s | Correct | Heard as English (confidence 0.40) |
| small | 6.6 s | 9.9 to 10.3 s | Correct | Correct language (zh, 0.87): "你可以幫我介紹一下Emily Carm" |

During the run the CPU peaked at 69.2 °C, the 5 V input stayed at or above 5.11 V, and
`get_throttled` read `0x0`. Only `small` understood the Chinese question, and it adds about 10 s
before Gemini receives the question.

## Sync

The first `run.py sync` filed 4 of the rover's 10 run folders (the answered phone turns, one asked
in Chinese) in 18 s, two Gemini requests each. A second pass filed nothing and took 1.2 s. With the
Pi unreachable, a pass gives up after the 8 s SSH connect timeout.

## Demo page

| Test | Setting | Measurement |
|---|---|---|
| Frame rate | Chrome, 1440 x 900, painted scene with the story pages | 60 frames per second; longest frame 17 ms |
| Spoken clips | 19 clips, 977 characters of ElevenLabs speech | 688 KB of MP3; the ambience loop is 344 KB |

## Costs and limits

- Gemini runs on the Google AI Studio free tier. On 2026-09-26, `gemini-3.8-flash` returned quota
  errors naming a limit of 20 requests at 02:04, 02:09, and 02:14, then answered at 02:19, so the
  limit window is shorter than a day. `gemini.retries` retries 503 "high demand" errors; a quota
  error stops the run.
- ElevenLabs runs on the Creator plan: 131,000 characters a month, resetting on the 25th. 3,568
  were used before the demo page's clips, which took 977 more. `run.py usage` shows the balance.
- Google's terms allow free-tier prompts and replies to be used to improve its products. Check the
  billing setting and terms before recording members of the public.
