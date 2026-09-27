"""A camera that stays open between questions, so each capture skips the warm-up."""

import io
import time
from pathlib import Path

HERE = Path(__file__).parent


class Camera:
    def __init__(self, config: dict):
        self.settings = config["camera"]
        self.backend = None
        if self.settings["image_file"]:
            return
        if self.settings["backend"] == "picamera2":
            self._open_picamera2()
        elif self.settings["backend"] == "opencv":
            self._open_opencv()
        else:
            raise SystemExit("camera.backend must be picamera2 or opencv")
        time.sleep(self.settings["warmup_seconds"])

    def _open_picamera2(self):
        try:
            from picamera2 import Picamera2
        except ImportError:
            raise SystemExit(
                "picamera2 is missing. On the Pi, install python3-picamera2 with apt and "
                "create the venv with --system-site-packages (see README)."
            )
        self.camera = Picamera2()
        size = (self.settings["width"], self.settings["height"])
        self.camera.configure(
            self.camera.create_still_configuration(main={"size": size})
        )
        self.camera.options["quality"] = self.settings["jpeg_quality"]
        self.camera.start()
        self.backend = "picamera2"

    def _open_opencv(self):
        import cv2

        self.camera = cv2.VideoCapture(self.settings["index"])
        if not self.camera.isOpened():
            raise SystemExit(f"Camera {self.settings['index']} did not open")
        self.backend = "opencv"

    def capture_jpeg(self) -> bytes:
        if self.backend is None:
            return (HERE / self.settings["image_file"]).read_bytes()
        if self.backend == "picamera2":
            buffer = io.BytesIO()
            self.camera.capture_file(buffer, format="jpeg")
            return buffer.getvalue()
        import cv2

        # OpenCV buffers a few frames; discard them so the capture shows the present moment.
        for _ in range(3):
            self.camera.grab()
        ok, frame = self.camera.read()
        if not ok:
            raise SystemExit("The camera opened but returned no frame")
        quality = [cv2.IMWRITE_JPEG_QUALITY, self.settings["jpeg_quality"]]
        return cv2.imencode(".jpg", frame, quality)[1].tobytes()

    def close(self) -> None:
        if self.backend == "picamera2":
            self.camera.stop()
            self.camera.close()
        elif self.backend == "opencv":
            self.camera.release()
