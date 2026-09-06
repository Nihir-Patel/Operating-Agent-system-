# OAS for OpenClaw

This directory contains the OAS (Operating Agent Systems) configuration for the OpenClaw harness.

## What is installed

- `rules/oas/` — shared coding rules and guidelines
- `skills/oas/` — reusable skills
- `commands/` — slash commands
- `AGENTS.md` — agent instructions

## Manual install

```bash
bash ./install.sh --target openclaw --profile minimal
```

## Notes

- OpenClaw config files (`openclaw.json`, `config.toml`, `.env`, etc.) are **not** touched by OAS install.
- Use `npx oas-universal doctor --target openclaw` to check install health.
