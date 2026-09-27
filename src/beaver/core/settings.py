"""Load an app's config.toml, apply --set overrides, and render prompt files."""

import tomllib
from pathlib import Path
from string import Template

# Prompts every app shares; an app's own prompts/ folder is searched first.
CORE_PROMPTS = Path(__file__).parent / "prompts"


def load_config(path: Path, overrides: list[str]) -> dict:
    """The config file sits in its app's folder; `app_dir` records that folder (as a string, so
    the config stays JSON-serializable in run records) for run folders and app prompts."""
    config = tomllib.loads(path.read_text())
    for override in overrides:
        apply_override(config, override)
    config["app_dir"] = str(path.resolve().parent)
    return config


def app_dir(config: dict) -> Path:
    return Path(config["app_dir"])


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
    name = config["prompts"][role]
    path = app_dir(config) / "prompts" / name
    if not path.exists():
        path = CORE_PROMPTS / name
    values = {**config["prompt_vars"], **(extra_vars or {})}
    try:
        return Template(path.read_text()).substitute(values).strip()
    except KeyError as missing:
        raise SystemExit(
            f"{path.name} uses ${{{missing.args[0]}}}, which [prompt_vars] lacks"
        )
