# How it works

Two diagrams: the parts of Beaver and what travels between them, and the guard proxy that decides
what the AI services receive. `python3 docs/img/make_diagrams.py` redraws both images from the
layout in that script.

## The parts

![The parts of Beaver: on the rover, a local guard proxy sits between the rover and the AI services, sending Gemini text without personal information and checking the answer before ElevenLabs speaks it; the desktop app asks both its own questions without the proxy yet and pulls each rover turn over SSH every 60 seconds](img/how-it-works-parts.svg)

The rover hears a spoken question, takes a camera frame, and speaks the answer on its own speaker.
It does not send the question to the AI services directly. A guard proxy runs on the rover between
it and every remote AI service: each request passes through the proxy, which forwards only what it
has cleaned, and each answer passes back through it before the rover speaks.

- Gemini writes the answer from clean text and the camera frame.
- ElevenLabs turns the checked answer into speech.

The laptop never receives a request from the rover. Every 60 seconds the desktop app connects to
the rover over SSH, pulls each new turn's saved record and camera frame, and files the turn into a
notebook. The desktop app also takes its own questions, typed or spoken at the laptop, and answers
them sentence by sentence in English, French, or both, plus the visitor's language; those
questions do not pass through a guard proxy yet.

## The guard proxy

![The guard proxy: the spoken question stays on the rover; Whisper turns it into text and the guard proxy removes personal information, so Gemini receives only clean text and a camera frame; the proxy checks the answer before ElevenLabs speaks it; desktop app questions reach Gemini as recorded](img/how-it-works-privacy.svg)

The guard proxy is a local checkpoint between a device that hears people and a cloud AI that
answers them. The cloud AI needs the question's meaning, not the person's voice or their personal
details, so the proxy sends the meaning and keeps the rest on the device.

1. **The recording stays on the rover.** It is saved there and never sent anywhere, not even to
   the laptop.
2. **Transcribe on the rover.** Whisper turns the recording into text on the rover itself. When the
   visitor's language is not certain (under 0.7), the rover asks the visitor to choose one and
   sends nothing.
3. **Clean the question.** The proxy replaces personal information with a plain phrase: email
   addresses, phone numbers, postal codes, street addresses, social insurance numbers, health card
   numbers, and payment card numbers. "My number is 613 555 0142" leaves the rover as "my number is
   a phone number".
4. **Ask Gemini.** Gemini receives the clean text, the language, and a camera frame; never the
   recording.
5. **Check the answer.** The proxy runs the same check on Gemini's answer and shortens it at a
   sentence end if it is too long to speak, before ElevenLabs speaks it and before the rover saves
   it.

The rover's saved record keeps the clean question and the names of the checks that fired, never
the original words.

What the proxy does not cover yet:

- The camera frame goes to Gemini as the camera took it; nothing checks it for faces, documents,
  or screens.
- Questions asked in the desktop app go to Gemini as they are: a spoken one is sent as audio.

For developers: the proxy is `src/beaver/rover/guard.py`, transcription is
`src/beaver/rover/transcribe.py`, and [architecture.md](architecture.md) describes the network
path and the files each part keeps.
