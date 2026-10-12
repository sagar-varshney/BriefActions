"""Persistent, account-scoped Postgres storage for hosted deployments."""
import re
from contextlib import contextmanager


class PostgresConnection:
    def __init__(self, connection, owner):
        self.connection, self.owner = connection, owner

    def execute(self, sql, params=()):
        if sql.strip().upper() == 'BEGIN IMMEDIATE':
            # Serialize writes within one account; nested read connections stay free.
            return self.connection.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))', (self.owner,))
        return self.connection.execute(sql.replace('?', '%s'), params)


@contextmanager
def postgres_connection(url, owner):
    if not isinstance(owner, str) or not re.fullmatch(r'[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}', owner):
        raise ValueError('A verified account is required for hosted storage')
    import psycopg
    with psycopg.connect(url, connect_timeout=10, prepare_threshold=None) as conn:
        conn.execute('SET LOCAL ROLE flow_app')
        conn.execute("SELECT set_config('search_path','flow,pg_catalog',true)")
        conn.execute("SELECT set_config('flow.owner',%s,true)", (owner,))
        conn.execute("SET LOCAL statement_timeout = '20s'")
        yield PostgresConnection(conn, owner)
