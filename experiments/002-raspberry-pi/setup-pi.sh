#!/usr/bin/env bash
# Set up experiment 002 on a Raspberry Pi 5 running 64-bit Raspberry Pi OS with Python 3.13.
# Run from the repo root: bash experiments/002-raspberry-pi/setup-pi.sh
set -euo pipefail

if ! python3 -c 'import sys; sys.exit(sys.version_info[:2] != (3, 13))'; then
  echo "The system Python is $(python3 --version); this repo pins 3.13, which Raspberry Pi OS"
  echo "based on Debian 13 (trixie) ships. picamera2 comes from apt and only imports into the"
  echo "system Python, so the venv must use it."
  exit 1
fi

# picamera2, gpiozero, and lgpio come from apt because they bind to system libraries
# (libcamera, the Pi 5 GPIO chip); PortAudio backs the sounddevice package.
sudo apt-get update
sudo apt-get install -y python3-picamera2 python3-gpiozero python3-lgpio libportaudio2

if ! command -v uv >/dev/null; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

# --system-site-packages lets the venv import the apt packages above.
if [ ! -d .venv ]; then
  uv venv --system-site-packages --python /usr/bin/python3
fi
UV_PYTHON_DOWNLOADS=never uv sync --group pi

# Fetch the stand-in wake word model and openWakeWord's feature models.
uv run --group pi python -c \
  "from openwakeword import utils; utils.download_models(model_names=['hey_jarvis'])"

cat <<'EOF'

Setup finished. If you have not yet enabled I2S audio, add these lines to
/boot/firmware/config.txt and reboot:

  dtparam=i2s=on
  dtoverlay=googlevoicehat-soundcard

Then check the hardware:

  arecord -l                    # the I2S card should appear as a capture device
  aplay -l                      # and as a playback device
  rpicam-hello --list-cameras   # the OV5647 should appear
  uv run --group pi python experiments/002-raspberry-pi/run.py devices
EOF
