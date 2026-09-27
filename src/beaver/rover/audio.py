"""I2S microphone capture as 16 kHz frames, speaker playback, and the listening chime."""

import io
import queue
import shutil
import subprocess
import wave

import numpy as np
import sounddevice as sd
from scipy import signal

from beaver.core.record import RunRecord

RATE = 16000
# 80 ms at 16 kHz: the frame size openWakeWord expects.
FRAME = 1280


def find_device(name: str, kind: str):
    """Index of the first `kind` ("input" or "output") device whose name contains `name`."""
    if name == "":
        return None
    for index, device in enumerate(sd.query_devices()):
        if (
            name.lower() in device["name"].lower()
            and device[f"max_{kind}_channels"] > 0
        ):
            return index
    raise SystemExit(f"No {kind} sound device matches {name!r}; run `run.py devices`")


def level_dbfs(frame: np.ndarray) -> float:
    rms = np.sqrt(np.mean(frame.astype(np.float64) ** 2))
    return 20 * np.log10(rms / 32768 + 1e-9)


def to_wav(pcm: bytes, rate: int) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(pcm)
    return buffer.getvalue()


class Microphone:
    """Opens the capture device once and queues 80 ms frames of 16 kHz int16 mono.

    The callback selects the signal channel, applies gain, and low-pass filters before
    decimating, with filter state carried across blocks so frame edges stay continuous."""

    def __init__(self, config: dict):
        settings = config["microphone"]
        if settings["capture_rate"] % RATE:
            raise SystemExit(f"microphone.capture_rate must be a multiple of {RATE}")
        self.factor = settings["capture_rate"] // RATE
        self.channel = settings["channel"]
        self.gain = 10 ** (settings["gain_db"] / 20)
        self.scale = float(np.iinfo(settings["dtype"]).max)
        if self.factor > 1:
            self.taps = signal.firwin(63, 0.9 / self.factor)
            self.state = np.zeros(len(self.taps) - 1)
        self.frames = queue.Queue()
        # Loudest raw sample per channel, before gain, for `run.py mictest`.
        self.channel_peaks = np.zeros(settings["channels"])
        self.stream = sd.InputStream(
            samplerate=settings["capture_rate"],
            channels=settings["channels"],
            dtype=settings["dtype"],
            device=find_device(settings["device"], "input"),
            blocksize=FRAME * self.factor,
            callback=self._collect,
        )

    def _collect(self, indata, _frames, _time, _status):
        peaks = np.abs(indata.astype(np.float64)).max(axis=0) / self.scale
        np.maximum(self.channel_peaks, peaks, out=self.channel_peaks)
        samples = indata[:, self.channel].astype(np.float64) / self.scale * self.gain
        if self.factor > 1:
            samples, self.state = signal.lfilter(self.taps, 1.0, samples, zi=self.state)
            samples = samples[:: self.factor]
        self.frames.put((np.clip(samples, -1, 1) * 32767).astype(np.int16))

    def __enter__(self):
        self.stream.start()
        return self

    def __exit__(self, *_):
        self.stream.stop()
        self.stream.close()

    def read(self) -> np.ndarray:
        return self.frames.get()

    def flush(self) -> None:
        """Drop queued frames, such as the rover's own speech or chime."""
        while not self.frames.empty():
            self.frames.get_nowait()


_speaker_enabled = False


def enable_speaker(config: dict) -> None:
    """Drive the amplifier's enable pin high, once per process.

    The Robot HAT v4 powers its speaker only while GPIO 20 is high, and after boot the DAC overlay
    leaves that pin as an I2S input. pinctrl runs without sudo for members of the gpio group."""
    global _speaker_enabled
    pin = config["speaker"]["enable_pin"]
    if _speaker_enabled or pin < 0:
        return
    if not shutil.which("pinctrl"):
        raise SystemExit("speaker.enable_pin needs pinctrl; set it to -1 off the Pi")
    subprocess.run(["pinctrl", "set", str(pin), "op", "dh"], check=True)
    _speaker_enabled = True


def play_pcm(config: dict, record: RunRecord, pcm: bytes, rate: int) -> None:
    if not config["speaker"]["play"]:
        return
    enable_speaker(config)
    with record.timed("playback"):
        sd.play(
            np.frombuffer(pcm, dtype=np.int16),
            samplerate=rate,
            device=find_device(config["speaker"]["device"], "output"),
        )
        sd.wait()


def chime(config: dict) -> None:
    settings = config["speaker"]
    if not (settings["play"] and settings["chime"]):
        return
    enable_speaker(config)
    t = np.arange(int(RATE * settings["chime_seconds"])) / RATE
    # A 10 ms fade at each end avoids clicks.
    fade = np.minimum(1, np.minimum(t, t[-1] - t) / 0.01)
    tone = 0.3 * np.sin(2 * np.pi * settings["chime_hz"] * t) * fade
    sd.play(
        tone.astype(np.float32),
        samplerate=RATE,
        device=find_device(settings["device"], "output"),
    )
    sd.wait()
