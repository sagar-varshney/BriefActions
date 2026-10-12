"""Stream authenticated workspace exports through the bounded Node worker queue."""
import json
import sys
from data_controls import export_lines
from web_bridge import store

try:
    for line in export_lines(store()):
        print(json.dumps(line,ensure_ascii=False),flush=True)
except Exception:
    # No transcript, query parameters, or credentials in worker diagnostics.
    print('Workspace export failed.',file=sys.stderr)
    sys.exit(1)
