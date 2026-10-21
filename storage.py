"""Persistent, account-scoped Postgres storage for hosted deployments."""
import re
from contextlib import contextmanager
from contextvars import ContextVar
from time import monotonic


_connections = ContextVar('flow_connections', default=None)


class ConnectionCache:
    """Small, worker-local cache of idle connections, never open transactions."""
    def __init__(self, max_idle=2, idle_seconds=60):
        self.max_idle, self.idle_seconds = max_idle, idle_seconds
        self.idle = []

    def take(self, url):
        import psycopg
        while self.idle:
            saved_url, conn, stamp = self.idle.pop()
            if saved_url == url and not conn.closed and monotonic()-stamp < self.idle_seconds:
                return conn, True
            conn.close()
        return psycopg.connect(url, connect_timeout=10, prepare_threshold=None), False

    def put(self, url, conn):
        from psycopg.pq import TransactionStatus
        if conn.closed or conn.info.transaction_status != TransactionStatus.IDLE or len(self.idle) >= self.max_idle:
            conn.close()
        else:
            self.idle.append((url, conn, monotonic()))

    def close(self):
        while self.idle:
            self.idle.pop()[1].close()


@contextmanager
def reusable_connections():
    """Enabled only inside one serial worker; other callers keep one-shot storage."""
    cache = ConnectionCache()
    token = _connections.set(cache)
    try:
        yield cache
    finally:
        _connections.reset(token)
        cache.close()


class PostgresConnection:
    def __init__(self, connection, owner):
        self.connection, self.owner = connection, owner

    def execute(self, sql, params=()):
        if sql.strip().upper() == 'BEGIN IMMEDIATE':
            # Serialize writes within one account; nested read connections stay free.
            return self.connection.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))', (self.owner,))
        return self.connection.execute(sql.replace('?', '%s'), params)


@contextmanager
def postgres_connection(url, owner, allow_closing=False):
    if not isinstance(owner, str) or not re.fullmatch(r'[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}', owner):
        raise ValueError('A verified account is required for hosted storage')
    import psycopg
    cache = _connections.get()
    conn, reused = cache.take(url) if cache else (psycopg.connect(url, connect_timeout=10, prepare_threshold=None), False)
    try:
        try:
            # One round trip configures a fresh transaction, including RLS scope.
            conn.execute("SELECT set_config('role','flow_app',true), "
                         "set_config('search_path','flow,pg_catalog',true), "
                         "set_config('flow.owner',%s,true), "
                         "set_config('statement_timeout','20s',true)", (owner,))
        except (psycopg.OperationalError, psycopg.InterfaceError):
            if not reused:
                raise
            # Only reconnect before application code runs. Never replay a write.
            conn.close()
            conn = psycopg.connect(url, connect_timeout=10, prepare_threshold=None)
            conn.execute("SELECT set_config('role','flow_app',true), "
                         "set_config('search_path','flow,pg_catalog',true), "
                         "set_config('flow.owner',%s,true), "
                         "set_config('statement_timeout','20s',true)", (owner,))
        if not allow_closing:
            from data_controls import DataError
            row=conn.execute('SELECT state FROM account_lifecycle').fetchone()
            if row and row[0]=='deleting':raise DataError('Account deletion is pending. Retry it from Data & account.')
        yield PostgresConnection(conn, owner)
        conn.commit()
    except BaseException:
        # Failed/ambiguous operations discard the connection and propagate to the
        # caller. Transaction-local roles/owners cannot survive into another user.
        try:
            conn.rollback()
        finally:
            conn.close()
        raise
    finally:
        if cache:
            cache.put(url, conn)
        else:
            conn.close()
