# OAS for Hermes

This directory contains the OAS (Operating Agent Systems) configuration for the Hermes harness.

## What is installed

- `rules/oas/` — shared coding rules and guidelines
- `skills/oas/` — reusable skills
- `commands/` — slash commands
- `AGENTS.md` — agent instructions

## Manual install

```bash
bash ./install.sh --target hermes --profile minimal
```

## Notes

- Hermes config files (`config.yaml`, `.env`, etc.) are **not** touched by OAS install.
- Use `npx oas-universal doctor --target hermes` to check install health.
