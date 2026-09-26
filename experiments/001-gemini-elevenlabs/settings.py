"""Load config.toml, apply --set overrides, and render prompt files."""

import tomllib
from pathlib import Path
from string import Template

HERE = Path(__file__).parent


def load_config(path: Path, overrides: list[str]) -> dict:
    config = tomllib.loads(path.read_text())
    for override in overrides:
        apply_override(config, override)
    return config


def apply_override(config: dict, override: str) -> None:
    """Apply one `section.key=value` override; the value parses as TOML, else as a string."""
    dotted, sep, raw = override.partition("=")
    section, dot, key = dotted.partition(".")
    if not sep or not dot:
        raise SystemExit(f"--set expects section.key=value, got {override!r}")
    if section not in config or key not in config[section]:
        raise SystemExit(f"--set {dotted}: no such setting in config.toml")
    try:
        value = tomllib.loads(f"v = {raw}")["v"]
    except tomllib.TOMLDecodeError:
        value = raw
    config[section][key] = value


def render_prompt(config: dict, role: str, extra_vars: dict | None = None) -> str:
    """Fill a prompt file's ${name} placeholders from [prompt_vars]; a missing name is an error."""
    path = HERE / "prompts" / config["prompts"][role]
    values = {**config["prompt_vars"], **(extra_vars or {})}
    try:
        return Template(path.read_text()).substitute(values).strip()
    except KeyError as missing:
        raise SystemExit(
            f"{path.name} uses ${{{missing.args[0]}}}, which [prompt_vars] lacks"
        )
