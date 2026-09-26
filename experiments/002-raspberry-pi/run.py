"""Experiment 002: the Gemini and ElevenLabs loop on a Raspberry Pi 5. See README.md.

uv run --group pi python experiments/002-raspberry-pi/run.py <command> [words] [--set section.key=value ...]
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
import gemini
import speech
from record import RunRecord
from settings import HERE, load_config, render_prompt


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
    speak(config, record, reply, question_end)
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

    load_dotenv(HERE.parents[1] / ".env")
    missing = [
        k for k in ("GEMINI_API_KEY", "ELEVENLABS_API_KEY") if not os.environ.get(k)
    ]
    if missing:
        sys.exit(f"Missing from .env: {', '.join(missing)}")
    config = load_config(args.config, args.set)
    COMMANDS[args.command][0](config, args)


if __name__ == "__main__":
    main()
