# Sourced by local launchers. Prefer installed tools; reuse Codex's bundled
# runtime when this desktop machine has no Node/pnpm on its shell PATH.
flow_runtime_root="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies"
if ! command -v node >/dev/null 2>&1; then
  if [ -x "$flow_runtime_root/node/bin/node" ]; then
    export PATH="$flow_runtime_root/node/bin:$PATH"
  else
    echo "Install Node.js 22.12+ and pnpm 11+ first. See README.md." >&2
    exit 1
  fi
fi
if command -v pnpm >/dev/null 2>&1; then
  flow_pnpm_cmd="$(command -v pnpm)"
elif [ -x "$flow_runtime_root/bin/fallback/pnpm" ]; then
  flow_pnpm_cmd="$flow_runtime_root/bin/fallback/pnpm"
else
  echo "Install pnpm 11+ first. See README.md." >&2
  exit 1
fi
