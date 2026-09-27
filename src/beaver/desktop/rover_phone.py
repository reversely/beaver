"""Start and stop the rover's phone page from this app, and read its address, over SSH.

The rover's `run.py phone` opens a Cloudflare quick tunnel whose address and token change at every
start. Started from here, it runs detached on the Pi in its own process group, writes the address
to a file only the Pi's user can read, and keeps the address out of its log. The commands sent to
the Pi are fixed strings built from this app's config, never from a request.
"""

import re
import subprocess

# Relative to [rover] remote_dir on the Pi.
ROVER = "src/beaver/rover"
PID = f"{ROVER}/phone.pid"
LOG = f"{ROVER}/phone.log"
ADDRESS = f"{ROVER}/phone-address.txt"
# The server's exit code, written by the shell that runs it when the server ends on its own. A stop
# from here ends that shell too, so a clean stop leaves no exit file.
EXIT = f"{ROVER}/phone.exit"
# libcamera's own log lines, which the camera prints after the server's last message.
CAMERA_LINE = re.compile(r"^\[\d+:\d{2}:\d{2}\.\d+\]")
REBOOTED = "The phone page ended when the rover restarted"


def _ssh(config: dict, command: str) -> str:
    settings = config["sync"]
    done = subprocess.run(
        [
            "ssh",
            "-o",
            "BatchMode=yes",
            "-o",
            f"ConnectTimeout={settings['connect_timeout_seconds']}",
            settings["host"],
            command,
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=settings["connect_timeout_seconds"] + 20,
    )
    return done.stdout


def _in_rover(config: dict, command: str) -> str:
    return f"cd {config['rover']['remote_dir']} && {command}"


def status(config: dict) -> dict:
    """{"state": "stopped" | "starting" | "running", "address", "error", "note"}. A server that is
    not running has its address file removed, since its tunnel and token are gone."""
    out = _ssh(
        config,
        _in_rover(
            config,
            # An exit file means the server ended; whatever is left of its group, such as
            # cloudflared, is stopped with it.
            f"if [ -f {EXIT} ] && [ -f {PID} ]; then kill -TERM -- -$(cat {PID}) 2>/dev/null; fi; "
            f"if [ ! -f {EXIT} ] && [ -f {PID} ] && kill -0 -- -$(cat {PID}) 2>/dev/null; "
            f"then echo RUNNING; else rm -f {ADDRESS}; fi; "
            f"echo ---; cat {ADDRESS} 2>/dev/null; echo; "
            f"echo ---; cat {EXIT} 2>/dev/null; echo; "
            # Seconds between the server's start and the Pi's boot; positive means it started
            # before the Pi last booted.
            f"echo ---; if [ -f {PID} ]; then "
            f"echo $(( $(date +%s) - $(stat -c %Y {PID}) - $(cut -d. -f1 /proc/uptime) )); fi; "
            f"echo ---; tail -n 60 {LOG} 2>/dev/null; true",
        ),
    )
    return parse_status(out)


def parse_status(out: str) -> dict:
    alive, address, code, before_boot, log = (
        part.strip() for part in out.split("---", 4)
    )
    state = {"state": "stopped", "address": None, "error": None, "note": None}
    if alive:
        state["state"] = "running" if address else "starting"
        state["address"] = address or None
    elif code and code != "0":
        # Above 128, a signal ended the server, and its log holds no reason.
        if int(code) > 128:
            state["error"] = f"ended by signal {int(code) - 128}"
        else:
            state["error"] = failure_reason(log) or f"exit code {code}"
    elif before_boot and int(before_boot) > 0:
        state["note"] = REBOOTED
    return state


def failure_reason(log: str) -> str | None:
    """The server's last own line: a traceback's final line or a SystemExit message, skipping the
    camera's log lines."""
    lines = [
        line.strip()
        for line in log.splitlines()
        if line.strip() and not CAMERA_LINE.match(line.strip())
    ]
    return lines[-1] if lines else None


def start(config: dict) -> dict:
    """Start the phone page on the Pi unless it already runs; returns the status."""
    current = status(config)
    if current["state"] != "stopped":
        return current
    run = (
        f"{config['rover']['uv']} run --group rover python {ROVER}/run.py phone "
        "--set phone.print_address=false"
    )
    # A background job in a shell without job control is not a group leader, so setsid runs the
    # wrapping shell as the leader of a new group whose id is $!; stop signals that whole group,
    # which includes the server and cloudflared.
    _ssh(
        config,
        _in_rover(
            config,
            f"rm -f {ADDRESS} {EXIT}; "
            f"setsid sh -c '{run}; echo $? > {EXIT}' > {LOG} 2>&1 < /dev/null & echo $! > {PID}",
        ),
    )
    return {"state": "starting", "address": None, "error": None, "note": None}


def stop(config: dict) -> dict:
    _ssh(
        config,
        _in_rover(
            config,
            f"if [ -f {PID} ]; then kill -TERM -- -$(cat {PID}) 2>/dev/null; rm -f {PID}; fi; "
            f"rm -f {EXIT}",
        ),
    )
    return {"state": "stopped", "address": None, "error": None, "note": None}
