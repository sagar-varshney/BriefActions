"""Encrypted, streaming logical application backups. Never prints DB credentials.

Backs up application rows, not Supabase Auth, roles, SQL, or provider configuration.
Restore accepts data only, into an empty, separately provisioned target.
"""
import argparse
import base64
from contextlib import contextmanager
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import secrets
import sys
import tempfile
from uuid import UUID

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

ROOT = Path(__file__).resolve().parents[1]
MAGIC = b'FLOWBAK\x01'
MAX_BYTES = 8 * 1024**3
MAX_LINE = 64 * 1024**2
TABLES = {
    'events': ('event_id','run_id','kind','created_at','payload','owner_id'),
    'annotation_drafts': ('case_id','reviewer_key','mode','version','updated_at','payload','owner_id'),
    'deleted_inputs': ('run_id','owner_id'),
    'account_lifecycle': ('owner_id','state'),
}
LEDGER_TABLES = ('deleted_inputs','account_lifecycle')

class BackupError(ValueError):
    pass

def key_from_env():
    try:
        value = base64.b64decode(os.environ['FLOW_BACKUP_KEY'], validate=True)
        if len(value) != 32: raise ValueError()
        return value
    except (KeyError,ValueError):
        raise BackupError('Set FLOW_BACKUP_KEY to a base64-encoded 32-byte encryption key.') from None

def migrations():
    return {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((ROOT/'deploy/migrations').glob('*.sql'))}

def connection(url):
    options = conninfo_to_dict(url)
    hosts = options.get('host','').split(',')
    if any(host and host not in ('localhost','127.0.0.1','::1') and not host.startswith('/') for host in hosts):
        if options.get('sslmode') not in ('require','verify-ca','verify-full'):
            raise BackupError('Remote database connections require sslmode=require or certificate verification.')
    return psycopg.connect(url,connect_timeout=15,prepare_threshold=None)

def line(value):
    return (json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n').encode('utf-8')

def encrypt(lines, destination, key):
    """Only ciphertext touches disk; exclusive publication never overwrites a file."""
    destination = Path(destination)
    nonce = secrets.token_bytes(12)
    header = MAGIC + nonce
    cipher = Cipher(algorithms.AES(key),modes.GCM(nonce)).encryptor()
    cipher.authenticate_additional_data(header)
    fd, name = tempfile.mkstemp(prefix='.flow-encrypted-',dir=destination.parent)
    total = 0
    try:
        with os.fdopen(fd,'wb') as output:
            output.write(header)
            for chunk in lines:
                total += len(chunk)
                if total > MAX_BYTES: raise BackupError('Backup exceeds the 8 GiB limit.')
                output.write(cipher.update(chunk))
            output.write(cipher.finalize())
            output.write(cipher.tag)
            output.flush(); os.fsync(output.fileno())
        os.link(name,destination)  # Atomic and refuses existing files, including symlinks.
    finally:
        os.unlink(name)

@contextmanager
def decrypted(source,key):
    """Authenticate the complete file before making plaintext available to callers."""
    with open(source,'rb') as stream, tempfile.TemporaryFile(mode='w+b') as output:
        size = os.fstat(stream.fileno()).st_size
        header = stream.read(len(MAGIC)+12)
        if size < len(header)+16 or size > MAX_BYTES+len(MAGIC)+28 or header[:len(MAGIC)] != MAGIC:
            raise BackupError('Invalid or unsupported encrypted backup.')
        stream.seek(-16,os.SEEK_END); tag = stream.read(16)
        stream.seek(len(header))
        cipher = Cipher(algorithms.AES(key),modes.GCM(header[len(MAGIC):],tag)).decryptor()
        cipher.authenticate_additional_data(header)
        remaining = size-len(header)-16
        try:
            while remaining:
                chunk = stream.read(min(1024**2,remaining))
                if not chunk: raise BackupError('The backup is truncated.')
                remaining -= len(chunk); output.write(cipher.update(chunk))
            output.write(cipher.finalize())
        except Exception:
            raise BackupError('Backup authentication failed: wrong key, damaged, or incomplete file.') from None
        output.seek(0)
        yield output

def admin(conn):
    privileged = conn.execute('SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user').fetchone()
    if not privileged or not privileged[0]:
        raise BackupError('Use an administrator connection with BYPASSRLS; an account-scoped backup is incomplete.')
    conn.execute("SET LOCAL statement_timeout='120s'")

def verify_schema(conn):
    rows = conn.execute("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='flow' ORDER BY table_name,ordinal_position").fetchall()
    actual = {}
    for table,column in rows: actual.setdefault(table,[]).append(column)
    expected = {t:list(c) for t,c in TABLES.items()} | {'backup_metadata':['singleton','database_id']}
    if actual != expected: raise BackupError('Unexpected application schema. Apply the matching migrations and use a compatible backup tool.')

def records(url,kind):
    """One repeatable-read snapshot covers every account and table."""
    with connection(url) as conn:
        conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        admin(conn)
        verify_schema(conn)
        database_id = str(conn.execute('SELECT database_id FROM flow.backup_metadata WHERE singleton').fetchone()[0])
        stamp = conn.execute('SELECT transaction_timestamp()').fetchone()[0].isoformat()
        sequence = conn.execute('SELECT last_value FROM flow.events_event_id_seq').fetchone()[0]
        selected = TABLES if kind == 'backup' else {t:TABLES[t] for t in LEDGER_TABLES}
        yield line({'type':'manifest','schema':'flow-backup-v1','kind':kind,'database_id':database_id,'created_at':stamp,'migrations':migrations(),'event_sequence':sequence})
        digest = hashlib.sha256(); counts = {t:0 for t in selected}
        for table,columns in selected.items():
            query = sql.SQL('SELECT {} FROM flow.{} ORDER BY {}').format(sql.SQL(',').join(map(sql.Identifier,columns)),sql.Identifier(table),sql.Identifier(columns[0]))
            with conn.cursor(name='backup_'+table) as cursor:
                cursor.itersize = 200
                cursor.execute(query)
                for row in cursor:
                    values = [str(value) if isinstance(value,UUID) else value for value in row]
                    encoded = line({'type':'row','table':table,'values':values})
                    if len(encoded) > MAX_LINE: raise BackupError('A stored row exceeds the 64 MiB limit.')
                    digest.update(encoded); counts[table] += 1
                    yield encoded
        yield line({'type':'complete','counts':counts,'sha256':digest.hexdigest()})

def json_lines(stream):
    stream.seek(0)
    while raw := stream.readline(MAX_LINE+1):
        if len(raw) > MAX_LINE or not raw.endswith(b'\n'): raise BackupError('Invalid backup record size or incomplete record.')
        try: value = json.loads(raw)
        except (ValueError,UnicodeError): raise BackupError('Invalid backup JSON record.') from None
        if not isinstance(value,dict): raise BackupError('Invalid backup record.')
        yield raw,value

def validate(stream,kind):
    iterator = json_lines(stream)
    try: _,manifest = next(iterator)
    except StopIteration: raise BackupError('The backup is empty.') from None
    if manifest.get('type') != 'manifest' or manifest.get('schema') != 'flow-backup-v1' or manifest.get('kind') != kind:
        raise BackupError('Unsupported backup format or file kind.')
    try:
        UUID(manifest['database_id'])
        if datetime.fromisoformat(manifest['created_at']).utcoffset() is None: raise ValueError()
        if type(manifest['event_sequence']) is not int or not 1 <= manifest['event_sequence'] < 2**63: raise ValueError()
    except (ValueError,KeyError,TypeError): raise BackupError('Invalid backup manifest.') from None
    if manifest.get('migrations') != migrations():
        raise BackupError('Restore with the same database migration files used to create this backup.')
    selected = TABLES if kind == 'backup' else {t:TABLES[t] for t in LEDGER_TABLES}
    counts = {t:0 for t in selected}; digest = hashlib.sha256(); complete = False
    for raw,value in iterator:
        if complete: raise BackupError('Unexpected records after backup completion.')
        if value.get('type') == 'complete':
            if value.get('counts') != counts or value.get('sha256') != digest.hexdigest(): raise BackupError('Backup record counts or digest do not match.')
            complete = True
            continue
        table = value.get('table'); values = value.get('values')
        if value.get('type') != 'row' or table not in selected or not isinstance(values,list) or len(values) != len(selected[table]):
            raise BackupError('Invalid backup table or row shape.')
        for column,item in zip(selected[table],values):
            if column in ('event_id','version'):
                if type(item) is not int or not 1 <= item < 2**63: raise BackupError('Invalid row number.')
            elif not isinstance(item,str): raise BackupError('Invalid row field.')
            if column == 'owner_id':
                try: UUID(item)
                except ValueError: raise BackupError('Invalid account identifier.') from None
            if column == 'state' and item != 'deleting': raise BackupError('Invalid account lifecycle.')
        counts[table] += 1; digest.update(raw)
    if not complete: raise BackupError('The backup is missing its completion record.')
    return manifest,counts

def restore(backup,target,key,ledger=None,ack_missing_ledger=False):
    if ledger is None and not ack_missing_ledger:
        raise BackupError('Supply a fresh erasure ledger. Disaster recovery without one requires explicit acknowledgement.')
    with decrypted(backup,key) as contents:
        manifest,counts = validate(contents,'backup')
        with decrypted(ledger,key) if ledger else tempfile.TemporaryFile() as ledger_contents:
            if ledger:
                latest,_ = validate(ledger_contents,'ledger')
                if latest['database_id'] != manifest['database_id']: raise BackupError('The erasure ledger belongs to another database.')
                if datetime.fromisoformat(latest['created_at']) < datetime.fromisoformat(manifest['created_at']): raise BackupError('The erasure ledger predates this backup.')
            with connection(target) as conn:
                admin(conn)
                tables = sql.SQL(',').join(sql.Identifier('flow',t) for t in (*TABLES,'backup_metadata'))
                conn.execute(sql.SQL('LOCK TABLE {} IN ACCESS EXCLUSIVE MODE').format(tables))
                verify_schema(conn)
                for table in TABLES:
                    if conn.execute(sql.SQL('SELECT EXISTS(SELECT FROM flow.{})').format(sql.Identifier(table))).fetchone()[0]:
                        raise BackupError('Restore target contains application data. Use a newly provisioned empty database.')
                # Trusted fixed tables only; no executable SQL comes from the file.
                for table in TABLES:
                    conn.execute(sql.SQL('ALTER TABLE flow.{} DISABLE TRIGGER USER').format(sql.Identifier(table)))
                for _,record in json_lines(contents):
                    if record['type'] != 'row': continue
                    table = record['table']; columns = TABLES[table]
                    query = sql.SQL('INSERT INTO flow.{} ({}) OVERRIDING SYSTEM VALUE VALUES ({})').format(sql.Identifier(table),sql.SQL(',').join(map(sql.Identifier,columns)),sql.SQL(',').join(sql.Placeholder() for _ in columns))
                    conn.execute(query,record['values'])
                for table in TABLES:
                    conn.execute(sql.SQL('ALTER TABLE flow.{} ENABLE TRIGGER USER').format(sql.Identifier(table)))
                # Apply latest deletion markers through the same owner-scoped purge functions as the app.
                if ledger:
                    ledger_rows = json_lines(ledger_contents)
                    for _,record in ledger_rows:
                        if record.get('type') != 'row': continue
                        values = record['values']
                        owner = values[1] if record['table'] == 'deleted_inputs' else values[0]
                        conn.execute("SELECT set_config('flow.owner',%s,true)",(owner,))
                        if record['table'] == 'deleted_inputs': conn.execute('SELECT flow.erase_input(%s)',(values[0],))
                        else: conn.execute('SELECT flow.erase_account()')
                max_id = conn.execute('SELECT coalesce(max(event_id),1) FROM flow.events').fetchone()[0]
                # Sequence changes are not rolled back; perform them only after all data validation/writes.
                conn.execute("SELECT setval('flow.events_event_id_seq',%s,true)",(max(max_id,manifest['event_sequence']),))
                conn.execute('UPDATE flow.backup_metadata SET database_id=%s WHERE singleton',(manifest['database_id'],))
    return counts

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command',required=True)
    sub.add_parser('generate-key',help='Print a new encryption key. Store it separately from backups.')
    for kind in ('backup','ledger'):
        command = sub.add_parser(kind)
        command.add_argument('--output',required=True)
    command = sub.add_parser('restore')
    command.add_argument('--input',required=True)
    command.add_argument('--ledger')
    command.add_argument('--confirm-empty-target',action='store_true',required=True)
    command.add_argument('--acknowledge-missing-erasure-ledger',action='store_true')
    args = parser.parse_args()
    if args.command == 'generate-key':
        print(base64.b64encode(secrets.token_bytes(32)).decode()); return
    try:
        key = key_from_env()
        if args.command in ('backup','ledger'):
            url = os.environ.get('FLOW_BACKUP_DATABASE_URL')
            if not url: raise BackupError('Set FLOW_BACKUP_DATABASE_URL to the source administrator connection.')
            encrypt(records(url,args.command),args.output,key)
            print('Encrypted file created successfully.')
        else:
            url = os.environ.get('FLOW_RESTORE_DATABASE_URL')
            if not url: raise BackupError('Set FLOW_RESTORE_DATABASE_URL to a separately provisioned empty target.')
            restore(args.input,url,key,args.ledger,args.acknowledge_missing_erasure_ledger)
            print('Application restore completed. Verify account access and deletion requests before cutover.')
    except BackupError as error:
        print(str(error),file=sys.stderr); sys.exit(1)
    except Exception as error:
        # Database exception text may contain connection credentials or private row payloads.
        print(f'Backup operation failed ({type(error).__name__}). No credentials or row data are logged.',file=sys.stderr); sys.exit(1)

if __name__ == '__main__': main()
