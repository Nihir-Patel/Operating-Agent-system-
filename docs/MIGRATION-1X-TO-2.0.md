# Migrating From OAS 1.x (operating-agent-systems) To 2.0

OAS 2.0 renamed the repo (`neal0709/operating-agent-systems` → `neal0709/Operating-Agent-system-`) and the plugin identifier (`operating-agent-systems@operating-agent-systems` → `oas@oas`). If you installed 1.x, follow this guide to upgrade cleanly. See also the [Naming + Migration Note](../README.md#naming--migration-note) in the README.

## TL;DR

```bash
# 1. Install 2.0
/plugin marketplace add https://github.com/neal0709/Operating-Agent-system-
/plugin install oas@oas

# 2. Remove the old plugin
/plugin uninstall operating-agent-systems@operating-agent-systems
```

Then remove any leftover 1.x folders (see below) and restart the session.

## "I now see two OAS plugins"

Expected. `oas@oas` and `operating-agent-systems@operating-agent-systems` are treated as separate plugins by Claude Code. Uninstall the old one; keep only `oas@oas`. Running both duplicates skills, commands, and hook executions.

## Leftover folders after uninstalling 1.x

`/plugin uninstall` removes the plugin from the active list, but can leave the old directory in the Claude plugin cache and any manual copies in your home directory.

Safe to delete after the old plugin no longer appears in `/plugin` list:

- The old plugin folder under the Claude plugins directory (e.g. `~/.claude/plugins/...operating-agent-systems...`)
- A 1.x manual install in your home folder (a cloned `operating-agent-systems/` directory), **if** you are not using it as a working checkout
- Old manually-copied surfaces under `~/.claude/` (`skills/`, `commands/`, `agents/` entries that came from 1.x) — the 2.0 plugin provides current versions

Do NOT delete `~/.claude/rules/` content you copied intentionally, or personal memory/state files.

## Does removing 1.x affect my existing projects?

No. OAS is a harness layer: skills, commands, agents, hooks. It does not alter your project code or git history. Everything OAS produced in your repos (commits, files, PRs) is untouched. Your next session simply loads 2.0 surfaces instead of 1.x ones. Slash-command namespaces changed from `operating-agent-systems:*` to `oas:*`.

## One install path only

Do not stack the plugin install with the manual installer (`install.sh` / `install.ps1` / `npx oas-universal install --profile full`). Pick one path; stacking creates duplicate skills and duplicate hook runs. If you already stacked, see [Reset / Uninstall OAS](../README.md#reset--uninstall-oas).

## Using 2.0 across harnesses (Codex, Antigravity/agy, OpenCode, Cursor)

2.0 is cross-harness. Use the manual installer with a target:

```bash
npx oas-universal install --profile core --target codex      # Codex CLI
npx oas-universal install --profile core --target opencode   # OpenCode
npx oas-universal install --profile core --target cursor     # Cursor
```

Run `npx oas-universal consult "<what you need>" --target <harness>` to preview which components fit before installing. Harness-specific guides: [ANTIGRAVITY-GUIDE.md](./ANTIGRAVITY-GUIDE.md), [HERMES-SETUP.md](./HERMES-SETUP.md), [QWEN-GUIDE.md](./QWEN-GUIDE.md), [JOYCODE-GUIDE.md](./JOYCODE-GUIDE.md).
