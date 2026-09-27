# Rover hardware

The rover is a SunFounder PiCar-X built on a Raspberry Pi 5 and a SunFounder Robot HAT v4.

## Parts

| Part | Detail |
|---|---|
| Computer | Raspberry Pi 5 Model B Rev 1.1, 4 GB, Raspberry Pi OS 64-bit (Debian 13, trixie), Python 3.13 |
| HAT | SunFounder Robot HAT v4. It has no ID EEPROM, so the `robot_hat` library treats it as v4 |
| Speaker | On the HAT, driven by the `hifiberry-dac` overlay (a PCM5102A DAC, playback only). The amplifier plays only while GPIO 20 is high; `speaker.enable_pin = 20` makes every rover command raise it before playback |
| Microphone | None. The v4 HAT has no microphone, and Bluetooth headsets such as AirPods Max pair with the Pi but deliver no microphone audio. The phone page stands in (see [architecture.md](architecture.md)) |
| Camera | OV5647 (5 MP) on a CAM/DISP connector, through the Pi 5's narrow 22-pin adapter cable |
| Button | The HAT's USER button on GPIO 25 (`button.pin`) |
| Mouth screen | SSD1306 OLED, 128 by 64 dots, at I2C address `0x3C` on bus 1, mounted upside down (see below) |
| Head servos | The camera's pan servo on the HAT's `P0` and tilt servo on `P1`, both mounted inverted |

## Mouth screen

The OLED shows Beaver's mouth (`src/beaver/rover/mouth.py`, the `[mouth]` section of
`config.toml`). The panel's colours are fixed in the glass: dot rows 0 to 15 light yellow and rows
16 to 63 blue, with a physical gap at row 16. The mouth uses only the blue rows. The panel is
mounted upside down, so each frame is drawn as a visitor sees it and turned 180 degrees before
sending; a visitor sees the blue rows as the top of the screen.

The mouth is the prototype's dot-grid picture: a stepped top lip and two solid buck teeth that are
the same in every frame, and a lower lip that passes behind the teeth and drops below them with the
loudness of the speech, 12 times a second. The rover writes the screen through `/dev/i2c-1` and
sends only the 8-row pages that changed. At the bus's 100 kHz, the largest change, fully open to
closed, took 61 to 75 ms to send, within the 83 ms frame period.

The screen shares I2C bus 1 with the HAT's controller at `0x14`. On 2026-09-27 the screen stopped
answering at `0x3C` after working, and a bus scan found only `0x14`; the rover speaks without the
mouth while the screen is missing and tries it again on each reply.

## Head servos

`robot_hat.Servo("P0")` pans the head and `Servo("P1")` tilts it; both take the angle with its sign
flipped, as SunFounder's `picarx` library drives them. The sensors project's limits are pan -90 to
90 degrees and tilt -35 to 65 degrees. `robot_hat` retries a failed I2C write without end, so a
stuck HAT controller makes a servo call hang; `robot_hat.reset_mcu()` resets the controller, after
which the servos moved normally on 2026-09-27. Only one program may drive the HAT at a time.

The v4 HAT uses GPIO 20 for the speaker enable, which is also the data-in pin of the I2S block the
DAC uses (GPIO 18 to 21), so an I2S microphone cannot share that block with the speaker. The
speaker needs `dtoverlay=hifiberry-dac` in `/boot/firmware/config.txt`, which SunFounder's installer
adds and `setup-pi.sh` checks for; switching it to `googlevoicehat-soundcard` replaces the speaker
driver.

The DAC accepts only its own sample rates, so opening it directly for an ElevenLabs reply fails with
`Invalid sample rate`. `setup-pi.sh` writes a resampling ALSA device named `speaker` to
`~/.asoundrc`, and the rover's `speaker.device` names it. On 2026-09-27 a fresh card with only
`setup-pi.sh` played a reply through it.

The camera is detected only at boot (`camera_auto_detect=1`). After reseating the ribbon, with the
power off, `rpicam-hello --list-cameras` should list the OV5647.

A power cut during a package install can leave truncated files, both in the environment and in
uv's cache on the Pi, which later installs reuse. Linux had not yet written the new files to the SD
card when the power went. A truncated native library makes Python die on import with a bus error
(exit 135): `tokenizers.abi3.so` was cut to exactly 4,194,304 bytes of its 11,079,248, and `av`
also failed on import until the same reinstall. A second cut left two of `av`'s libraries at exactly
4,194,304 bytes again; comparing every installed file with the hash in its package's `RECORD` found
them, and a reinstall followed by `sync` fixed them. `uv cache clean <package>` and a reinstall fix it. Install with
`UV_CONCURRENT_INSTALLS=1` and `nice -n 19` to keep the load low.

The Pi boots the 4 KB-page kernel, `kernel8.img`, selected by `kernel=kernel8.img` at the end of
`/boot/firmware/config.txt` (the previous file is `config.txt.bak`). Raspberry Pi OS's default on
the Pi 5 is the 16 KB-page `kernel_2712.img`; the switch was made while the bus errors were blamed
on page size, before the truncated files were found.

## Power

The Pi runs from the HAT's two-cell battery pack through a regulator of about 3 A. `vcgencmd
get_throttled` reports under-voltage since boot, and `vcgencmd pmic_read_adc EXT5V_V` reads the
5 V input.

| When | Reading | Effect |
|---|---|---|
| Battery flat (0.0 V on the HAT) | `0x50000` (under-voltage and throttling since boot), 4.89 V input | The speaker produced a buzz instead of speech |
| Battery charged (6.74 to 8.34 V) | `0x0`, 5.19 to 5.22 V input | Clean speech |

Keep the Pi's own USB-C port unplugged while the HAT powers it. With a cable from the laptop in
that port alongside the HAT, the Pi read a battery of about 5.7 V, a 4.94 V input, and under-voltage
(`0x50000`), and it reset unexpectedly at least three times on 2026-09-26 and 2026-09-27. After the
cable came out, the same battery read 8.34 V, the input 5.22 V, and `get_throttled` `0x0`, steady
under a package install and a Gemini request.

That cable does not explain every drop. At about 01:06 on 2026-09-27, with the cable out and the
readings above, the Pi went unreachable a few minutes into a Whisper benchmark (two threads,
`nice -n 19`) and stayed unreachable for more than 10 minutes. Every earlier drop also came during
sustained CPU load. A later full Whisper run on HAT battery (two threads, `nice -n 19`) finished
without a drop: the input stayed at or above 5.11 V, `get_throttled` read `0x0`, and the CPU
reached 69.2 °C with no fan. The Pi has no cooler; heavier work would call for the Pi 5 Active
Cooler.

## Network access

The Pi joins eduroam through a NetworkManager profile named `eduroam`. Eduroam blocks `.local`
name lookup and connections between devices, so the laptop reaches the Pi through Tailscale:

- The Pi belongs to another Tailscale account and is shared into this laptop's account at
  `100.126.130.50`. Tailscale SSH is off on the Pi, so SSH goes to the Pi's own OpenSSH server as
  `pi`, with the laptop's key in `~/.ssh/authorized_keys`.
- The Pi cannot open a connection back to the laptop, so the desktop app pulls the rover's turns.
- On a guest network such as "RMUS Office_Guest", Tailscale reached the Pi only through a relay
  whose public address changed twice within a minute on 2026-09-27; each change dropped the open SSH
  sessions while the Pi kept running. Run long jobs detached (`nohup setsid`) with their output in a
  file, so a dropped session does not stop them.
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
