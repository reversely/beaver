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

The v4 HAT uses GPIO 20 for the speaker enable, which is also the data-in pin of the I2S block the
DAC uses (GPIO 18 to 21), so an I2S microphone cannot share that block with the speaker. SunFounder's
installer adds `hifiberry-dac` to `/boot/firmware/config.txt`; switching it to
`googlevoicehat-soundcard` replaces the speaker driver.

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
