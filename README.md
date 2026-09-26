# beaver

Beaver is an AI rover deepning your understanding Canadian politics, history & culture. It travels with you around the city providing historical context for each street, translates between a native language and French/English, and encourages civic engagement for Canadians and tourists alike.

## Setup

beaver uses [uv](https://docs.astral.sh/uv/) for Python 3.13 and its dependencies.

```
uv sync
uv run pre-commit install
```

`uv sync` builds the environment from `uv.lock`. `pre-commit install` adds a git hook that runs
ruff, file checks, and a secrets scan on every commit.

## Configuration

Credentials go in a `.env` file at the repo root. Git ignores `.env`.

## Documentation

- `docs/`: committed design and reference documents.
- `docs/log.md`, `docs/plans/`, `docs/progress/`: local working files. Git ignores them.

## Contributing

Work is tracked as GitHub issues in `reversely/beaver`. Each commit closes one issue with
`closes #N` in the commit message body.
