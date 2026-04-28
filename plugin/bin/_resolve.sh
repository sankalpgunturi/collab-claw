#!/usr/bin/env bash
# _resolve.sh — sourced by the bin/* shims to find a usable `collab-claw`
# binary. The plugin can be installed two ways:
#
#   1. End user has installed the npm package globally:
#        $ npm install -g collab-claw
#      → `collab-claw` is on $PATH.
#
#   2. End user is running directly from a git checkout (or marketplace
#      ./plugin source). In that case the plugin lives at
#      <repo>/plugin and the CLI lives at <repo>/bin/collab-claw.
#      We can find it by walking up from $CLAUDE_PLUGIN_ROOT or, if that
#      env var is unset (Spike B F3), from $0.
#
# After this script runs, $COLLAB_CLAW points at an executable to invoke.

resolve_collab_claw() {
  if command -v collab-claw >/dev/null 2>&1; then
    echo "$(command -v collab-claw)"
    return 0
  fi

  local plugin_root=""
  if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" ]]; then
    plugin_root="$CLAUDE_PLUGIN_ROOT"
  else
    local self_dir
    self_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    # bin/ → ../ is the plugin root
    plugin_root="$(cd "$self_dir/.." && pwd)"
  fi

  # Repo-checkout layout: <repo>/plugin/.claude-plugin + <repo>/bin/collab-claw
  if [[ -x "$plugin_root/../bin/collab-claw" ]]; then
    echo "$(cd "$plugin_root/.." && pwd)/bin/collab-claw"
    return 0
  fi

  # In-tree fallback: plugin author bundled the CLI inside the plugin
  if [[ -x "$plugin_root/bin/collab-claw" ]]; then
    echo "$plugin_root/bin/collab-claw"
    return 0
  fi

  # Last resort: try `npx collab-claw` if available
  if command -v npx >/dev/null 2>&1; then
    echo "npx --no-install collab-claw"
    return 0
  fi

  echo ""
  return 1
}

COLLAB_CLAW="$(resolve_collab_claw)"
export COLLAB_CLAW
