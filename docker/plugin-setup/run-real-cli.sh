#!/usr/bin/env bash

set -euo pipefail

readonly OAS_ROOT=/oas
readonly SOURCE_PROJECT=/source-project
readonly MODE="${1:-dry-run}"
readonly requested_project_dir="${OAS_PROJECT_DIR:-/workspace/project}"

NPM_CONFIG_CACHE=/tmp/npm-cache
export NPM_CONFIG_CACHE
readonly NPM_CONFIG_CACHE

usage() {
  printf '%s\n' \
    'Usage: docker compose run --rm real-cli <mode>' \
    '' \
    'Modes:' \
    '  dry-run  Inspect a project-local OAS install without mutation (default).' \
    '  install  Install OAS into the isolated project copy.' \
    '  plugin   Launch Claude with the local OAS checkout via --plugin-dir.' \
    '  shell    Open a shell in the isolated project copy.'
}

case "$MODE" in
  dry-run|install|plugin|shell)
    ;;
  help|--help|-h)
    usage
    exit 0
    ;;
  *)
    printf 'Unknown mode: %s\n\n' "$MODE" >&2
    usage >&2
    exit 2
    ;;
esac

if [[ ! -f "$OAS_ROOT/package.json" ]]; then
  printf 'OAS checkout is not mounted at %s\n' "$OAS_ROOT" >&2
  exit 2
fi
if [[ ! -d "$SOURCE_PROJECT" ]]; then
  printf 'Source project is not mounted at %s\n' "$SOURCE_PROJECT" >&2
  exit 2
fi
project_dir="$(
  node "$OAS_ROOT/docker/plugin-setup/resolve-project-dir.js" \
    "$requested_project_dir"
)"
readonly project_dir

mkdir -p "$HOME" "$CLAUDE_CONFIG_DIR" "$NPM_CONFIG_CACHE"
chmod 0700 "$HOME" "$CLAUDE_CONFIG_DIR" "$NPM_CONFIG_CACHE"

if [[ ! -e "$project_dir" ]]; then
  mkdir -m 0700 "$project_dir"
  cp -a "$SOURCE_PROJECT/." "$project_dir/"
elif [[ ! -d "$project_dir" ]]; then
  printf 'OAS project path is not a directory: %s\n' "$project_dir" >&2
  exit 2
fi
cd "$project_dir"

if [[ ! -d .git ]]; then
  git init --quiet
fi

packed_cli=''
if [[ "$MODE" == dry-run || "$MODE" == install ]]; then
  packed_cli="$(
    node "$OAS_ROOT/docker/plugin-setup/prepare-packed-cli.js" \
      "$OAS_ROOT" \
      /tmp/oas-packed-cli
  )"
fi
readonly packed_cli

run_oas() {
  if [[ ! -x "$packed_cli" ]]; then
    printf 'Packed OAS public executable is unavailable\n' >&2
    return 1
  fi
  "$packed_cli" "$@"
}

run_install() {
  run_oas install \
    --profile core \
    --target claude-project \
    "$@"
}

claude --version
printf 'Isolated project: %s\n' "$project_dir"

case "$MODE" in
  dry-run)
    plan_file="$(mktemp /tmp/oas-install-plan.XXXXXX.json)"
    run_install \
      --dry-run \
      --json > "$plan_file"
    if [[ -e "$project_dir/.claude" ]]; then
      printf 'Dry run unexpectedly mutated %s/.claude\n' "$project_dir" >&2
      exit 1
    fi
    node "$OAS_ROOT/docker/plugin-setup/verify-install-plan.js" "$project_dir" --dry-run < "$plan_file"
    cat "$plan_file"
    ;;
  install)
    run_install --json
    if [[ ! -f "$project_dir/.claude/oas/install-state.json" ]]; then
      printf 'Install did not create confined install state\n' >&2
      exit 1
    fi
    run_install --json
    run_oas list-installed --json
    run_oas doctor --target claude-project
    ;;
  plugin)
    exec claude --plugin-dir "$OAS_ROOT"
    ;;
  shell)
    exec /bin/bash
    ;;
esac
