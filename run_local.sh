#!/bin/bash
set -e
cd "$(dirname "$0")"
source scripts/runtime.sh
if [ ! -d node_modules ]; then
  "$flow_pnpm_cmd" install --frozen-lockfile
fi
echo "Starting React at http://127.0.0.1:5173 and the API at port ${PORT:-3001}"
exec "$flow_pnpm_cmd" dev
