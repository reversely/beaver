"""Wait for a wake word, button press, or Enter key, then record the question.

Every trigger is checked once per 80 ms microphone frame, so any mix of them can be active."""

import select
import sys
import time
from pathlib import Path

import numpy as np

from audio import FRAME, RATE, Microphone, level_dbfs

HERE = Path(__file__).parent


FRAME_SECONDS = FRAME / RATE


class WakeWord:
    def __init__(self, config: dict):
        from openwakeword import utils
        from openwakeword.model import Model

        settings = config["wakeword"]
        name = settings["model"]
        if name.endswith(".onnx"):
            model = str(HERE / name)
        else:
            # Fetches the pre-trained model and openWakeWord's feature models once.
            utils.download_models(model_names=[name])
            model = name
        self.model = Model(
            wakeword_models=[model],
            inference_framework="onnx",
            vad_threshold=settings["vad_threshold"],
            enable_speex_noise_suppression=settings["noise_suppression"],
        )
        self.threshold = settings["threshold"]
        self.score = 0.0

    def detect(self, frame: np.ndarray) -> bool:
        self.score = max(self.model.predict(frame).values())
        return self.score >= self.threshold

    def reset(self) -> None:
        self.model.reset()


def _button(config: dict):
    try:
        from gpiozero import Button
    except ImportError:
        raise SystemExit(
            "The button trigger needs gpiozero, which Raspberry Pi OS ships as python3-gpiozero"
        )
    settings = config["button"]
    return Button(settings["pin"], pull_up=True, bounce_time=settings["bounce_seconds"])


def _enter_pressed() -> bool:
    if select.select([sys.stdin], [], [], 0)[0]:
        sys.stdin.readline()
        return True
    return False


class Triggers:
    def __init__(self, config: dict, microphone: Microphone):
        modes = config["trigger"]["modes"]
        unknown = set(modes) - {"wakeword", "button", "enter"}
        if unknown:
            raise SystemExit(f"Unknown trigger.modes: {', '.join(sorted(unknown))}")
        self.config = config
        self.microphone = microphone
        self.wakeword = WakeWord(config) if "wakeword" in modes else None
        self.button = _button(config) if "button" in modes else None
        self.enter = "enter" in modes

    def describe(self) -> str:
        ways = []
        if self.wakeword:
            ways.append(f'say "{self.config["wakeword"]["model"].replace("_", " ")}"')
        if self.button:
            ways.append(f"hold the button on GPIO {self.config['button']['pin']}")
        if self.enter:
            ways.append("press Enter")
        return " or ".join(ways)

    def wait(self) -> str:
        """Block until a trigger fires; return its name."""
        self.microphone.flush()
        if self.wakeword:
            self.wakeword.reset()
        while True:
            frame = self.microphone.read()
            if self.button and self.button.is_pressed:
                return "button"
            if self.enter and _enter_pressed():
                return "enter"
            if self.wakeword and self.wakeword.detect(frame):
                return "wakeword"

    def record(self, trigger: str) -> np.ndarray | None:
        """Record the question. A button records while held, Enter records until the next
        Enter, and a wake word records until the visitor goes quiet. None means no speech."""
        settings = self.config["endpoint"]
        max_frames = int(self.config["trigger"]["max_seconds"] / FRAME_SECONDS)
        silence_frames = int(settings["silence_seconds"] / FRAME_SECONDS)
        no_speech_frames = int(settings["no_speech_seconds"] / FRAME_SECONDS)
        self.microphone.flush()
        frames, quiet, heard = [], 0, False
        while len(frames) < max_frames:
            frame = self.microphone.read()
            frames.append(frame)
            if trigger == "button" and not self.button.is_pressed:
                break
            if trigger == "enter" and _enter_pressed():
                break
            if trigger == "wakeword":
                loud = level_dbfs(frame) > settings["silence_dbfs"]
                heard = heard or loud
                quiet = 0 if loud else quiet + 1
                if heard and quiet >= silence_frames:
                    break
                if not heard and len(frames) >= no_speech_frames:
                    return None
        return np.concatenate(frames)


def measure_wakeword(config: dict, seconds: float) -> None:
    """Listen for `seconds`, print each detection, and report the wake word's CPU cost."""
    with Microphone(config) as microphone:
        wakeword = WakeWord(config)
        print(f'Listening for {seconds:.0f} s. Say "{config["wakeword"]["model"]}".')
        frames, busy, peak = 0, 0.0, 0.0
        cpu_start, wall_start = time.process_time(), time.perf_counter()
        while frames * FRAME_SECONDS < seconds:
            frame = microphone.read()
            start = time.perf_counter()
            detected = wakeword.detect(frame)
            busy += time.perf_counter() - start
            peak = max(peak, wakeword.score)
            frames += 1
            if detected:
                print(
                    f"  detected at {frames * FRAME_SECONDS:5.1f} s, score {wakeword.score:.2f}"
                )
                wakeword.reset()
        cpu = time.process_time() - cpu_start
        wall = time.perf_counter() - wall_start
    print(f"\nHighest score: {peak:.2f} (threshold {config['wakeword']['threshold']})")
    print(f"Wake word time per 80 ms frame: {busy / frames * 1000:.1f} ms")
    print(f"Process CPU while listening: {cpu / wall * 100:.0f}% of one core")
