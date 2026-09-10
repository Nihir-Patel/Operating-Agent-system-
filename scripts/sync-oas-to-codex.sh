#!/usr/bin/env bash
set -Eeuo pipefail
exec "$(cd "$(dirname "$0")" && pwd)/sync-ecc-to-codex.sh" "$@"
