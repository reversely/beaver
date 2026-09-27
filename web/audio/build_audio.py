"""Generate the demo's spoken clips and ambience with ElevenLabs, once, into audio/*.mp3.

Run from the repo root (reads ELEVENLABS_API_KEY from .env and never prints it):
    uv run --group desktop python web/audio/build_audio.py

clips.json lists every clip: its id, voice role, language, and exact text. A clip whose MP3
already exists is skipped, so re-running only spends characters on new or deleted clips.
"""

import json
import os
import urllib.request
from pathlib import Path

from dotenv import load_dotenv

HERE = Path(__file__).parent
API = "https://api.elevenlabs.io/v1"


def post(path: str, body: dict, key: str) -> bytes:
    req = urllib.request.Request(
        f"{API}/{path}",
        data=json.dumps(body).encode(),
        headers={"xi-api-key": key, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def main() -> None:
    load_dotenv(HERE.parents[1] / ".env")
    key = os.environ["ELEVENLABS_API_KEY"]
    spec = json.loads((HERE / "clips.json").read_text())
    spent = 0
    for clip in spec["clips"]:
        out = HERE / f"{clip['id']}.mp3"
        if out.exists():
            continue
        voice = spec["voices"][clip["voice"]]
        audio = post(
            f"text-to-speech/{voice}?output_format=mp3_44100_64",
            {"text": clip["text"], "model_id": spec["model"]},
            key,
        )
        out.write_bytes(audio)
        spent += len(clip["text"])
        print(f"{out.name}: {len(audio) // 1024} KB")
    for amb in spec["ambience"]:
        out = HERE / f"{amb['id']}.mp3"
        if out.exists():
            continue
        audio = post(
            "sound-generation?output_format=mp3_44100_128",
            {
                "text": amb["text"],
                "duration_seconds": amb["seconds"],
                "prompt_influence": 0.5,
            },
            key,
        )
        out.write_bytes(audio)
        print(f"{out.name}: {len(audio) // 1024} KB")
    print(f"characters sent for speech: {spent}")


if __name__ == "__main__":
    main()
