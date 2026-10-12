import hashlib
import io
import os
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4
from unittest.mock import patch
from scripts.backup import BackupError,encrypt,decrypted,validate,line,migrations,restore

KEY = bytes(range(32))  # Public test fixture, never a production key.

def fixture(kind='backup',rows=()):
    from scripts.backup import TABLES,LEDGER_TABLES
    manifest = {'type':'manifest','schema':'flow-backup-v1','kind':kind,'database_id':str(uuid4()),'created_at':'2026-10-12T10:00:00+00:00','migrations':migrations(),'event_sequence':1}
    counts = {t:0 for t in (TABLES if kind=='backup' else LEDGER_TABLES)}
    digest = hashlib.sha256()
    result = [line(manifest)]
    for row in rows:
        encoded = line(row); result.append(encoded); digest.update(encoded); counts[row['table']] += 1
    result.append(line({'type':'complete','counts':counts,'sha256':digest.hexdigest()}))
    return result

class BackupTests(unittest.TestCase):
    def test_roundtrip_stream_and_file_permissions(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'backup.flowbak'; chunks=[b'private text \xf0\x9f\x93\x9d\n']*100000
            encrypt(iter(chunks),path,KEY)
            self.assertEqual(path.stat().st_mode & 0o777,0o600)
            self.assertNotIn(b'private text',path.read_bytes())
            with decrypted(path,KEY) as stream:self.assertEqual(stream.read(),b''.join(chunks))

    def test_wrong_key_tampering_and_truncation_never_yield_plaintext(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'backup.flowbak';encrypt([b'secret'],path,KEY); original=path.read_bytes()
            with self.assertRaises(BackupError):
                with decrypted(path,b'x'*32):self.fail('Released unauthenticated plaintext')
            for data in [original[:8],original[:-1],original+b'x',*[original[:i]+bytes([original[i]^1])+original[i+1:] for i in (0,10,21,len(original)-1)]]:
                path.write_bytes(data)
                with self.assertRaises(BackupError):
                    with decrypted(path,KEY):self.fail('Released unauthenticated plaintext')

    def test_exclusive_publish_and_failed_stream_cleanup(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'backup.flowbak';encrypt([b'first'],path,KEY);original=path.read_bytes()
            with self.assertRaises(FileExistsError):encrypt([b'second'],path,KEY)
            self.assertEqual(path.read_bytes(),original)
            def failure():
                yield b'partial'
                raise RuntimeError('fixture failure')
            with self.assertRaises(RuntimeError):encrypt(failure(),Path(folder)/'failed.flowbak',KEY)
            self.assertEqual(list(Path(folder).iterdir()),[path])

    def test_backup_and_ledger_validation(self):
        for kind in ('backup','ledger'):
            manifest,counts=validate(io.BytesIO(b''.join(fixture(kind))),kind)
            self.assertEqual(manifest['kind'],kind);self.assertFalse(any(counts.values()))
        row={'type':'row','table':'events','values':[1,'a'*32,'extraction','now','{"transcript":"private"}',str(uuid4())]}
        self.assertEqual(validate(io.BytesIO(b''.join(fixture(rows=[row]))),'backup')[1]['events'],1)

    def test_missing_completion_wrong_schema_digest_and_unknown_tables_rejected(self):
        data=fixture();original=b''.join(data)
        candidates=[b'',b''.join(data[:-1]),original+line({'type':'extra'}),original.replace(b'flow-backup-v1',b'flow-backup-v2'),original.replace(b'"events":0',b'"events":1'),data[0]+line({'type':'row','table':'arbitrary_sql','values':[]})+data[-1]]
        for value in candidates:
            with self.subTest(value=value[:80]),self.assertRaises(BackupError):validate(io.BytesIO(value),'backup')

    def test_restore_requires_latest_ledger_before_connecting(self):
        with self.assertRaisesRegex(BackupError,'fresh erasure ledger'):restore('not-opened','not-connected',KEY)

    def test_remote_connections_require_tls_and_keys_are_validated(self):
        from scripts.backup import connection,key_from_env
        with patch('scripts.backup.psycopg.connect') as connect:
            with self.assertRaises(BackupError):connection('postgresql://example.test/db')
            connect.assert_not_called()
            connection('postgresql://example.test/db?sslmode=verify-full');connect.assert_called_once()
        for value in ['','not-base64','eA==']:
            with patch.dict(os.environ,{'FLOW_BACKUP_KEY':value}),self.assertRaises(BackupError):key_from_env()

if __name__=='__main__':unittest.main()
