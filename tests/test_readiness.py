import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]

class ReadinessTests(unittest.TestCase):
    def test_persistent_probes_are_read_only_and_do_not_echo_private_input(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'private # history.sqlite3'
            with sqlite3.connect(path) as conn:
                for table in ('events','annotation_drafts','deleted_inputs','account_lifecycle'):conn.execute(f'CREATE TABLE {table}(value TEXT)')
                conn.execute("INSERT INTO events VALUES('private transcript canary')")
            stamp=path.stat().st_mtime_ns
            result=subprocess.run([sys.executable,'-B',str(ROOT/'readiness_bridge.py')],input='{"operation":"probe"}\n{"operation":"probe"}\n{"private":"secret canary"}\n',text=True,capture_output=True,timeout=5,env={**os.environ,'FLOW_DATABASE_URL':'','FLOW_HISTORY_PATH':str(path)})
            self.assertEqual(result.returncode,0)
            self.assertEqual([json.loads(line) for line in result.stdout.splitlines()],[{'ok':True},{'ok':True},{'ok':False}])
            self.assertNotIn('canary',result.stdout+result.stderr)
            self.assertEqual(path.stat().st_mtime_ns,stamp)

if __name__=='__main__':unittest.main()
