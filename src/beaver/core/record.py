"""Per-run folder: timings, the exact prompts sent, the reply, and any captured media."""

import json
import time
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from beaver.core.settings import app_dir


class RunRecord:
    def __init__(self, config: dict, step: str):
        # Local time, so folder names match the clock on the machine that ran them.
        stamp = datetime.now(UTC).astimezone().strftime("%Y%m%d-%H%M%S")
        self.base = app_dir(config)
        self.dir = self.base / config["output"]["runs_dir"] / f"{stamp}-{step}"
        self.dir.mkdir(parents=True)
        self.show_prompts = config["output"]["show_prompts"]
        self.data = {
            "step": step,
            "started": stamp,
            "config": config,
            "sent": [],
            "timings_ms": {},
        }

    @contextmanager
    def timed(self, label: str):
        start = time.perf_counter()
        try:
            yield
        finally:
            self.mark(label, start)

    def mark(self, label: str, start: float) -> None:
        self.data["timings_ms"][label] = round((time.perf_counter() - start) * 1000)

    def sent(self, service: str, **fields) -> None:
        """Log what went to a service; print it too when show_prompts is on."""
        self.data["sent"].append({"service": service, **fields})
        if self.show_prompts:
            print(f"\n----- sent to {service} -----")
            for name, value in fields.items():
                print(
                    f"[{name}]\n{value}\n"
                    if isinstance(value, str) and "\n" in value
                    else f"[{name}] {value}"
                )

    def save_file(self, name: str, data: bytes) -> Path:
        path = self.dir / name
        path.write_bytes(data)
        return path

    def finish(self, **fields) -> None:
        self.data.update(fields)
        (self.dir / "record.json").write_text(
            json.dumps(self.data, indent=2, ensure_ascii=False)
        )
        print("\n----- timings (ms) -----")
        for label, ms in self.data["timings_ms"].items():
            print(f"{label:>24}  {ms}")
        for key, tokens in self.data.items():
            if not key.endswith("_tokens"):
                continue
            by_type = ", ".join(f"{k} {v}" for k, v in tokens["prompt_by_type"].items())
            print(
                f"\n{key.removesuffix('_tokens')} tokens: prompt {tokens['prompt']} "
                f"({by_type}), reply {tokens['reply']}, thinking {tokens['thinking']}"
            )
        print(f"\nSaved to {self.dir.relative_to(self.base)}")
