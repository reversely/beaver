# How it works

Two diagrams: the parts of Beaver and what travels between them, and the guard proxy that decides
what the AI services receive. `python3 docs/img/make_diagrams.py` redraws both images from the
layout in that script.

## Parts

![Parts of Beaver: on the rover, local processing puts a guard proxy between the rover and the remote AI services; the proxy sends Gemini clean text and a photo and sends ElevenLabs the checked answer; the desktop app sends Gemini and ElevenLabs its own questions and copies each saved rover turn over SSH every 60 seconds](img/how-it-works-parts.svg)

The rover records a spoken question and a camera frame and plays the answer on its own speaker. A
guard proxy runs on the rover between it and every remote AI service: each request passes through
the proxy, which forwards only clean text and the photo, and each answer passes back through it
before playback.

- Gemini generates the answer from the clean text and the photo.
- ElevenLabs converts the checked answer into speech.

The desktop app pulls from the rover: every 60 seconds it connects to the rover over SSH, copies
each new turn's saved record and photo, and files the turn into a notebook. The desktop app also
takes its own questions, typed or spoken at the laptop, transcribes and guards them on the laptop the
same way, and answers them sentence by sentence in English, French, or both, plus the visitor's
language.

## Guard proxy

![Guard proxy: the recording stays on the rover; Whisper transcribes it and the guard proxy replaces personal information, so Gemini receives clean text and a photo; the proxy checks the answer before ElevenLabs converts it into speech](img/how-it-works-privacy.svg)

The guard proxy is a local checkpoint on the rover between its microphone input and the remote AI
services. It sends them text with personal information replaced and keeps the recording on the
rover.

1. **Recording.** The rover stores the recording in its own run folder.
2. **Transcription.** Whisper converts the recording into text on the rover. When Whisper scores
   every language on the rover's list under 0.7, the rover asks the visitor to choose a language
   and sends nothing.
3. **Cleaning.** The proxy replaces personal information with a plain phrase: email addresses,
   phone numbers, postal codes, street addresses, social insurance numbers, health card numbers,
   and payment card numbers. "My number is 613 555 0142" leaves the rover as "my number is a phone
   number".
4. **Question to Gemini.** Gemini receives the clean text, the language, and the photo.
5. **Answer check.** The proxy applies the same replacements to Gemini's answer and cuts it at a
   sentence end when it exceeds 600 characters, before ElevenLabs converts it and before the rover
   saves it.

The rover's saved record holds the clean question and the kinds of personal information the proxy
replaced.

For developers: the proxy is `src/beaver/core/guard.py`, transcription is
`src/beaver/core/transcribe.py`, both shared by the rover and the desktop app, and [architecture.md](architecture.md) describes the network
path and the files each part keeps.
