#!/bin/zsh
set -e
cd "${0:A:h}"
source scripts/runtime.sh
if [ ! -d node_modules ]; then
  "$flow_pnpm_cmd" install --frozen-lockfile
fi
echo "Starting Productivity Flow Engine at http://127.0.0.1:8765"
echo "Keep this terminal open. Press Ctrl+C to stop the server."
# Build once, then serve the React app and Node API together.
# caffeinate keeps macOS awake while the server runs; duration is not limited.
"$flow_pnpm_cmd" build
export PORT=8765
exec caffeinate -dimsu "$flow_pnpm_cmd" start
