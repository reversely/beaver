"""Microphone, speaker, and camera access."""

import io
import time
import wave

import numpy as np

from record import RunRecord


def _device(value):
    """Config stores "" for the system default, a name, or an index."""
    return None if value == "" else value


def record_wav(config: dict, record: RunRecord) -> tuple[bytes, float]:
    """Record 16-bit mono audio; return (WAV bytes, seconds recorded)."""
    import sounddevice as sd

    settings = config["microphone"]
    rate = settings["sample_rate"]
    seconds = settings["record_seconds"]
    frames = []

    def collect(indata, _frames, _time, _status):
        frames.append(indata.copy())

    with sd.InputStream(
        samplerate=rate,
        channels=1,
        dtype="int16",
        device=_device(settings["device"]),
        callback=collect,
    ):
        if seconds > 0:
            print(f"Recording for {seconds} seconds...")
            time.sleep(seconds)
        else:
            input("Recording. Press Enter to stop.")
    audio = np.concatenate(frames) if frames else np.zeros((0, 1), dtype="int16")
    duration = len(audio) / rate
    record.data["recorded_seconds"] = round(duration, 2)
    return pcm_to_wav(audio.tobytes(), rate), duration


def play_pcm(config: dict, record: RunRecord, pcm: bytes, rate: int) -> None:
    import sounddevice as sd

    if not config["speaker"]["play"]:
        return
    with record.timed("playback"):
        sd.play(
            np.frombuffer(pcm, dtype="int16"),
            samplerate=rate,
            device=_device(config["speaker"]["device"]),
        )
        sd.wait()


def pcm_to_wav(pcm: bytes, rate: int) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(pcm)
    return buffer.getvalue()


def capture_jpeg(config: dict, record: RunRecord) -> bytes:
    import cv2

    settings = config["camera"]
    with record.timed("camera"):
        camera = cv2.VideoCapture(settings["index"])
        try:
            if not camera.isOpened():
                raise SystemExit(
                    f"Camera {settings['index']} did not open. On macOS, allow camera access for "
                    "your terminal in System Settings > Privacy & Security > Camera."
                )
            for _ in range(settings["warmup_frames"]):
                camera.read()
            ok, frame = camera.read()
        finally:
            camera.release()
    if not ok:
        raise SystemExit("The camera opened but returned no frame.")
    ok, jpeg = cv2.imencode(
        ".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, settings["jpeg_quality"]]
    )
    return jpeg.tobytes()
