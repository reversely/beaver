"""Beaver rover: answer questions aloud on the Raspberry Pi 5. See README.md.

uv run --group rover python src/beaver/rover/run.py <command> [words] [--set section.key=value ...]
"""

import argparse
import os
import sys
import time
from contextlib import ExitStack, contextmanager
from pathlib import Path

import numpy as np
from dotenv import load_dotenv

import audio
from beaver.core import gemini, speech
from beaver.core.record import RunRecord
from beaver.core.settings import load_config, render_prompt

HERE = Path(__file__).parent


def speak(config, record, text, question_end=None):
    pcm, rate = speech.synthesize(config, record, text)
    record.save_file("reply.wav", audio.to_wav(pcm, rate))
    if question_end is not None:
        record.mark("question_end_to_speech", question_end)
    audio.play_pcm(config, record, pcm, rate)


def turn(config, record, microphone, triggers, camera, typed=None):
    """One question and answer. Typed words replace the microphone and trigger."""
    if typed:
        question = [render_prompt(config, "typed_question", {"question": typed})]
    else:
        print(f"\nReady: {triggers.describe()}.")
        trigger = triggers.wait()
        record.data["trigger"] = trigger
        audio.chime(config)
        start = time.perf_counter()
        samples = triggers.record(trigger)
        record.mark("question", start)
        if samples is None:
            return "(no speech after the wake word)"
        wav = audio.to_wav(samples.tobytes(), audio.RATE)
        path = record.save_file("question.wav", wav)
        seconds = len(samples) / audio.RATE
        question = [
            (wav, "audio/wav", f"{path.name}: {seconds:.1f} s of microphone audio")
        ]
    question_end = time.perf_counter()
    reply = ask_with_frame(config, record, camera, question)
    speak(config, record, reply, question_end)
    return reply


def ask_with_frame(config, record, camera, question):
    """Send the question with a fresh camera frame, when there is a camera, and return the reply."""
    image = []
    if camera:
        with record.timed("camera"):
            jpeg = camera.capture_jpeg()
        path = record.save_file("frame.jpg", jpeg)
        image = [
            (jpeg, "image/jpeg", f"{path.name}: {len(jpeg) // 1024} KB camera frame")
        ]
    system = render_prompt(config, "system")
    reply = gemini.ask(
        config, record, system, render_prompt(config, "look"), image + question
    )
    print(f"\n----- reply -----\n{reply}")
    return reply


@contextmanager
def session(config, typed):
    """Open the camera, and the microphone and triggers unless the question is typed."""
    from camera import Camera
    from triggers import Triggers

    with ExitStack() as stack:
        camera = None
        if config["look"]["include_image"]:
            camera = Camera(config)
            stack.callback(camera.close)
        if typed:
            yield camera, None, None
            return
        microphone = stack.enter_context(audio.Microphone(config))
        yield camera, microphone, Triggers(config, microphone)


def run_turn(config, microphone, triggers, camera, typed=None):
    record = RunRecord(config, "look")
    try:
        reply = turn(config, record, microphone, triggers, camera, typed)
    except (SystemExit, Exception) as error:
        record.finish(error=f"{type(error).__name__}: {error}")
        raise
    record.finish(reply=reply)


def cmd_look(config, args):
    typed = " ".join(args.words)
    with session(config, typed) as (camera, microphone, triggers):
        run_turn(config, microphone, triggers, camera, typed)


def cmd_loop(config, args):
    """Answer questions until Ctrl-C. A failed turn prints its error and the loop continues."""
    with session(config, "") as (camera, microphone, triggers):
        try:
            while True:
                try:
                    run_turn(config, microphone, triggers, camera)
                except SystemExit as error:
                    print(f"Turn failed: {error}")
        except KeyboardInterrupt:
            print("\nStopped.")


def guard_reply(config, record, reply):
    """Redact personal information from a reply, then shorten it at a sentence end when it is over
    elevenlabs.max_characters. Records which rules fired and how much was cut, never the original."""
    import guard

    text, findings = guard.redact(reply)
    text, dropped = guard.shorten(text, config["elevenlabs"]["max_characters"])
    record.data["guard_reply"] = {
        "rules": [f.rule for f in findings],
        "shortened_share": round(dropped, 2),
    }
    return text


def cmd_phone(config, args):
    """Take questions from a phone's browser; answer through the rover's camera and speaker.

    Each question is transcribed on the Pi in the language the phone page chose, or in the one
    Whisper detects when the page asks for automatic detection, and the guard redacts the
    transcript, so Gemini receives only redacted text, never the audio."""
    import guard
    from camera import Camera
    from phone import LastLocation, serve
    from transcribe import AUTO, LANGUAGES, Transcriber

    camera = Camera(config) if config["look"]["include_image"] else None
    print(f"Loading Whisper {config['transcribe']['model']}...")
    transcriber = Transcriber(config)

    location = LastLocation()

    def answer(wav, upload_ms, respond, language):
        record = RunRecord(config, "phone")
        question_end = time.perf_counter()
        # Rounded to about 1 km on the phone and again on the rover; only this pair is saved.
        record.data["location"] = location.get()
        record.data["timings_ms"]["upload"] = upload_ms
        record.data["question_language"] = language
        try:
            record.save_file("question.wav", wav)
            question = ""
            with record.timed("transcribe"):
                if language == AUTO:
                    language, heard, probability = transcriber.detect_and_transcribe(
                        wav
                    )
                    record.data["detected_language"] = {
                        "language": language,
                        "probability": round(probability, 2),
                    }
                else:
                    heard = transcriber(wav, language)
            if language:
                question, findings = guard.redact(heard)
                record.data["question"] = question
                record.data["guard_question"] = [f.rule for f in findings]
            if language is None:
                reply = (
                    "I could not tell which language you spoke. "
                    "Please choose your language on the page and ask again."
                )
            elif not question:
                reply = "I did not catch that. Please hold the button and ask again."
            else:
                prompt = render_prompt(config, "typed_question", {"question": question})
                note = f"The visitor asked in {LANGUAGES[language]}."
                reply = ask_with_frame(config, record, camera, [note, prompt])
                reply = guard_reply(config, record, reply)
            respond(reply)
            speak(config, record, reply, question_end)
        except (SystemExit, Exception) as error:
            record.finish(error=f"{type(error).__name__}: {error}")
            raise
        record.finish(reply=reply)

    try:
        serve(config, answer, location)
    finally:
        if camera:
            camera.close()


def cmd_text(config, args):
    record = RunRecord(config, "text")
    question = " ".join(args.words) or config["prompt_vars"]["question"]
    system = render_prompt(config, "system")
    reply = gemini.ask(
        config, record, system, render_prompt(config, "text", {"question": question})
    )
    print(f"\n----- reply -----\n{reply}")
    record.finish(reply=reply)


def cmd_speak(config, args):
    record = RunRecord(config, "speak")
    text = (
        " ".join(args.words)
        or "Bonjour, and welcome. I am your guide to Canadian culture."
    )
    speak(config, record, text)
    record.finish(reply=text)


def cmd_snap(config, args):
    """Capture one camera frame to a run folder, with no Gemini request."""
    from camera import Camera

    record = RunRecord(config, "snap")
    camera = Camera(config)
    try:
        with record.timed("camera"):
            jpeg = camera.capture_jpeg()
    finally:
        camera.close()
    record.save_file("frame.jpg", jpeg)
    record.finish(reply=f"{len(jpeg) // 1024} KB frame")


def cmd_devices(config, args):
    print(audio.sd.query_devices())
    try:
        from picamera2 import Picamera2
    except ImportError:
        print("\npicamera2 not installed; skipping the camera list.")
        return
    print("\nCameras:")
    for info in Picamera2.global_camera_info():
        print(f"  {info}")


def cmd_mictest(config, args):
    """Record a few seconds, report levels, and save the processed audio."""
    seconds = float(args.words[0]) if args.words else 5.0
    print(f"Recording {seconds:.0f} s. Stay quiet for a moment, then speak normally.")
    with audio.Microphone(config) as microphone:
        frames = [
            microphone.read() for _ in range(int(seconds / (audio.FRAME / audio.RATE)))
        ]
        peaks = microphone.channel_peaks.copy()
    print("\nRaw peak per channel, before gain (the signal channel is the loud one):")
    for channel, peak in enumerate(peaks):
        print(f"  channel {channel}: {20 * np.log10(peak + 1e-9):6.1f} dBFS")
    levels = np.array([audio.level_dbfs(frame) for frame in frames])
    print(f"\nAfter gain, channel {config['microphone']['channel']}:")
    print(f"  quiet frames (10th percentile):  {np.percentile(levels, 10):6.1f} dBFS")
    print(f"  loud frames (95th percentile):   {np.percentile(levels, 95):6.1f} dBFS")
    print(
        f"  endpoint.silence_dbfs is {config['endpoint']['silence_dbfs']}; set it between these."
    )
    record = RunRecord(config, "mictest")
    record.save_file(
        "mictest.wav", audio.to_wav(np.concatenate(frames).tobytes(), audio.RATE)
    )
    record.finish(reply="mictest")


def cmd_wakewordtest(config, args):
    from triggers import measure_wakeword

    measure_wakeword(config, float(args.words[0]) if args.words else 30.0)


def cmd_usage(config, args):
    from datetime import UTC, datetime

    from elevenlabs import ElevenLabs

    plan = ElevenLabs(api_key=os.environ["ELEVENLABS_API_KEY"]).user.subscription.get()
    resets = datetime.fromtimestamp(
        plan.next_character_count_reset_unix, tz=UTC
    ).astimezone()
    print(f"ElevenLabs plan: {plan.tier}")
    print(f"Characters used: {plan.character_count:,} of {plan.character_limit:,}")
    print(f"Resets:          {resets:%Y-%m-%d %H:%M}")


COMMANDS = {
    "loop": (cmd_loop, "answer questions until Ctrl-C"),
    "look": (
        cmd_look,
        "one question with a camera frame; typed words skip the microphone",
    ),
    "phone": (cmd_phone, "questions from a phone's browser, answered on the rover"),
    "text": (cmd_text, "typed question to Gemini, text reply"),
    "speak": (cmd_speak, "text to ElevenLabs, played on the speaker"),
    "snap": (cmd_snap, "save one camera frame"),
    "devices": (cmd_devices, "list sound devices and cameras"),
    "mictest": (cmd_mictest, "measure microphone levels; optional seconds"),
    "wakewordtest": (
        cmd_wakewordtest,
        "wake word detections and CPU cost; optional seconds",
    ),
    "usage": (cmd_usage, "ElevenLabs characters used and remaining"),
}


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "command",
        choices=COMMANDS,
        help="; ".join(f"{name}: {desc}" for name, (_, desc) in COMMANDS.items()),
    )
    parser.add_argument("words", nargs="*", help="question, text, or seconds")
    parser.add_argument("--config", type=Path, default=HERE / "config.toml")
    parser.add_argument(
        "--set", action="append", default=[], metavar="SECTION.KEY=VALUE"
    )
    args = parser.parse_args()

    load_dotenv(HERE.parents[2] / ".env")
    missing = [
        k for k in ("GEMINI_API_KEY", "ELEVENLABS_API_KEY") if not os.environ.get(k)
    ]
    if missing:
        sys.exit(f"Missing from .env: {', '.join(missing)}")
    config = load_config(args.config, args.set)
    COMMANDS[args.command][0](config, args)


if __name__ == "__main__":
    main()
