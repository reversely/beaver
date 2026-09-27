"""Start and stop the rover's phone page from this app, and read its address, over SSH.

The rover's `run.py phone` opens a Cloudflare quick tunnel whose address and token change at every
start. Started from here, it runs detached on the Pi in its own process group, writes the address
to a file only the Pi's user can read, and keeps the address out of its log. The commands sent to
the Pi are fixed strings built from this app's config, never from a request.
"""

import subprocess

# Relative to [rover] remote_dir on the Pi.
ROVER = "src/beaver/rover"
PID = f"{ROVER}/phone.pid"
LOG = f"{ROVER}/phone.log"
ADDRESS = f"{ROVER}/phone-address.txt"


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
    """{"state": "stopped" | "starting" | "running", "address": str | None, "log": [last lines]}"""
    out = _ssh(
        config,
        _in_rover(
            config,
            f"if [ -f {PID} ] && kill -0 -- -$(cat {PID}) 2>/dev/null; then echo RUNNING; fi; "
            f"echo ---; cat {ADDRESS} 2>/dev/null; echo; echo ---; tail -n 3 {LOG} 2>/dev/null; true",
        ),
    )
    alive, address, log = (part.strip() for part in out.split("---", 2))
    if not alive:
        # A server stopped from here ends its log with "Stopped."; any other ending is a failure.
        lines = log.splitlines()
        failed = lines and lines[-1] != "Stopped."
        return {"state": "stopped", "address": None, "log": lines if failed else []}
    if not address:
        return {"state": "starting", "address": None, "log": []}
    return {"state": "running", "address": address, "log": []}


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
    # server as the leader of a new group whose id is $!; stop signals that whole group, which
    # includes cloudflared.
    _ssh(
        config,
        _in_rover(
            config,
            f"rm -f {ADDRESS}; setsid {run} > {LOG} 2>&1 < /dev/null & echo $! > {PID}",
        ),
    )
    return {"state": "starting", "address": None, "log": []}


def stop(config: dict) -> dict:
    _ssh(
        config,
        _in_rover(
            config,
            f"if [ -f {PID} ]; then kill -TERM -- -$(cat {PID}) 2>/dev/null; rm -f {PID}; fi",
        ),
    )
    return {"state": "stopped", "address": None, "log": []}
