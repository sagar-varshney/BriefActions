"""Verify redacted detection of a deleted secret using an invented credential."""
import json
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile

root=Path(__file__).resolve().parent.parent
scanner=sys.argv[1]
with tempfile.TemporaryDirectory() as folder:
    repo=Path(folder)
    def git(*args):
        return subprocess.run(['git',*args],cwd=repo,check=True,capture_output=True,text=True)
    git('init','-q')
    git('config','user.name','Security scanner fixture')
    git('config','user.email','fixture@example.invalid')
    credential='sb_'+'secret_'+secrets.token_urlsafe(32)
    (repo/'fixture.txt').write_text('SUPABASE_SECRET_KEY='+credential+'\n')
    git('add','fixture.txt')
    git('commit','-qm','Add invented credential')
    git('rm','-q','fixture.txt')
    git('commit','-qm','Remove invented credential')
    report=repo/'report.json'
    result=subprocess.run([scanner,'git','--redact','--no-banner','--ignore-gitleaks-allow',
                           '--config',str(root/'.gitleaks.toml'),'--log-opts=--all',
                           '--report-format=json','--report-path',str(report),str(repo)],capture_output=True,text=True)
    assert result.returncode==1, 'Scanner did not detect a deleted credential'
    contents=report.read_text()
    assert credential not in contents+result.stdout+result.stderr, 'Scanner output was not redacted'
    assert any(row['RuleID']=='supabase-server-secret' for row in json.loads(contents)), 'Supabase secret rule did not run'
print('Secret-scanner regression passed: deleted invented credential detected; report and logs redacted.')
