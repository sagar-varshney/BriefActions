"""Request-local numeric timings; never retain queries or private input values."""
from contextlib import contextmanager
from contextvars import ContextVar
from time import perf_counter

_scope = ContextVar('performance_scope', default=None)


@contextmanager
def collect():
    value = {'totals': {}, 'active': set()}
    token = _scope.set(value)
    try:
        yield value['totals']
    finally:
        _scope.reset(token)


@contextmanager
def timed(name):
    scope = _scope.get()
    if scope is None or name in scope['active']:
        yield
        return
    started = perf_counter()
    scope['active'].add(name)
    try:
        yield
    finally:
        scope['active'].remove(name)
        scope['totals'][name] = scope['totals'].get(name, 0) + (perf_counter()-started)*1000
