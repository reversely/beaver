# Rover hardware

The rover is a SunFounder PiCar-X built on a Raspberry Pi 5 and a SunFounder Robot HAT v4.

## Parts

| Part | Detail |
|---|---|
| Computer | Raspberry Pi 5 Model B Rev 1.1, 4 GB, Raspberry Pi OS 64-bit (Debian 13, trixie), Python 3.13, kernel `6.18.50+rpt-rpi-2712` with 16 KB memory pages |
| HAT | SunFounder Robot HAT v4. It has no ID EEPROM, so the `robot_hat` library treats it as v4 |
| Speaker | On the HAT, driven by the `hifiberry-dac` overlay (a PCM5102A DAC, playback only). The amplifier plays only while GPIO 20 is high; `speaker.enable_pin = 20` makes every rover command raise it before playback |
| Microphone | None. The v4 HAT has no microphone, and Bluetooth headsets such as AirPods Max pair with the Pi but deliver no microphone audio. The phone page stands in (see [architecture.md](architecture.md)) |
| Camera | OV5647 (5 MP) on a CAM/DISP connector, through the Pi 5's narrow 22-pin adapter cable |
| Button | The HAT's USER button on GPIO 25 (`button.pin`) |

The v4 HAT uses GPIO 20 for the speaker enable, which is also the data-in pin of the I2S block the
DAC uses (GPIO 18 to 21), so an I2S microphone cannot share that block with the speaker. SunFounder's
installer adds `hifiberry-dac` to `/boot/firmware/config.txt`; switching it to
`googlevoicehat-soundcard` replaces the speaker driver.

The camera is detected only at boot (`camera_auto_detect=1`). After reseating the ribbon, with the
power off, `rpicam-hello --list-cameras` should list the OV5647.

The 16 KB page size breaks some prebuilt native libraries, which die on import with a bus error
(exit 135): `av` 18.1.0 and `tokenizers` 0.23.2 (both needed by faster-whisper), and
`huggingface_hub`'s `hf_xet` download accelerator, which `HF_HUB_DISABLE_XET=1` turns off.
`ctranslate2` 4.8.2 and `onnxruntime` 1.30.0 import normally. The Pi also has the
4 KB-page kernel, `kernel8.img`, which `kernel=kernel8.img` in `/boot/firmware/config.txt`
selects at boot.

## Power

The Pi runs from the HAT's two-cell battery pack through a regulator of about 3 A. `vcgencmd
get_throttled` reports under-voltage since boot, and `vcgencmd pmic_read_adc EXT5V_V` reads the
5 V input.

| When | Reading | Effect |
|---|---|---|
| Battery flat (0.0 V on the HAT) | `0x50000` (under-voltage and throttling since boot), 4.89 V input | The speaker produced a buzz instead of speech |
| Battery charged (6.74 to 8.34 V) | `0x0`, 5.19 to 5.22 V input | Clean speech |

The Pi reset unexpectedly at least three times on 2026-09-26 and 2026-09-27. After one reset, while
a Whisper benchmark and the phone page with its camera and tunnel ran together, the Pi's power-reset
flag read `0x2`. The cause is not yet confirmed. A 1-second log of throttle state and input voltage
during a later benchmark (model downloads, load average up to 3.34) read `0x0` throughout, with
the input at or above 5.15 V, and the Pi stayed up. No Whisper benchmark has produced a
transcription: the two earlier runs ended with the Pi unreachable, and in the last one
faster-whisper crashed on import (see the page-size note above).

## Network access

The Pi joins eduroam through a NetworkManager profile named `eduroam`. Eduroam blocks `.local`
name lookup and connections between devices, so the laptop reaches the Pi through Tailscale:

- The Pi belongs to another Tailscale account and is shared into this laptop's account at
  `100.126.130.50`. Tailscale SSH is off on the Pi, so SSH goes to the Pi's own OpenSSH server as
  `pi`, with the laptop's key in `~/.ssh/authorized_keys`.
- The Pi cannot open a connection back to the laptop, so the desktop app pulls the rover's turns.
- The phone reaches the rover through the Cloudflare quick tunnel, from eduroam or mobile data.

## Setup

From the laptop, copy the repo (including `.env`) to the Pi, then run the setup script on the Pi:

```
rsync -av --exclude .venv --exclude .git --exclude 'runs/' ~/Repos/beaver/ pi@100.126.130.50:~/beaver/
ssh pi@100.126.130.50 'cd ~/beaver && bash src/beaver/rover/setup-pi.sh'
```

`setup-pi.sh` installs `picamera2`, `gpiozero`, `lgpio`, and PortAudio with apt, creates the
environment with `--system-site-packages` so it can import them, installs the `rover` dependency
group, installs `cloudflared`, and downloads the wake word models.
