# Worker and connection reuse

The API previously started a Python interpreter for every operation, re-imported
the ML stack on each analysis, and opened a new PostgreSQL connection for every
history context. Ordinary API operations now reuse bounded, serial Python workers.
HistoryStore objects are scoped to one request, and a small worker-local cache
reuses idle database connections across separate transactions.

The first analysis in a process still loads the libraries. Free-host sleeping,
network latency, Supabase authentication checks and database work still contribute
to hosted response times. This change does not bypass authoritative sign-in
verification or cache private API responses.

## Local before/after drill

```sh
pnpm benchmark:workers artifacts/worker-performance.json
```

The drill uses a temporary SQLite database and five synthetic workflows for each
implementation: analyze, load, confirm. It removes its fixtures afterward. The
one-shot implementation remains available for this comparison and the independent
initial readiness check. CI retains the raw report; timing is diagnostic, not a
flaky pass/fail threshold. Run with the same Python and thread settings as the app.

A local run on 21 October 2026, excluding the first workflow from each median:

| Operation | Separate processes | Reused worker |
| --- | ---: | ---: |
| Analyze the small synthetic transcript | 1,349 ms | 9 ms |
| Load the saved meeting | 51 ms | 1 ms |
| Confirm its tasks | 49 ms | 2 ms |

The reused path started one Python process for all fifteen operations. Its first
analysis took 1,253 ms. These measurements isolate local process/import overhead;
they are **not hosted latency promises**, and SQLite does not measure the benefit
of reusing remote database connections. Run the drill on the target environment
and use the route-specific production histograms for a hosted comparison.

## Safety and resource limits

- Worker concurrency, queue limits and request/response bounds stay in force.
- Each request creates a fresh account/history context; no transcript or account
  result is cached across requests. Only imported code and idle connections persist.
- Each database transaction re-establishes the restricted role and verified owner,
  checks pending deletion, and commits or rolls back before the connection is idle.
- Nested database contexts borrow separate connections. Idle storage is bounded
  to two sockets per worker and stale entries expire on their next checkout.
- A failed/ambiguous application operation is never automatically replayed.
  Reconnect is allowed only during connection setup, before application code runs.
- Timeouts, crashed processes and invalid/oversized output discard the worker.
  Explicit user retries retain the existing request IDs and deduplication rules.
- Shutdown drains accepted requests, then stops workers and closes idle sockets.

Tests cover alternating accounts through one worker, real PostgreSQL RLS across
the same physical connection, stale-session reconnect, failed transactions,
explicit retries, protocol errors, output limits and shutdown. The production
container drill still runs under 512 MiB and 0.1 CPU.

Navigation and saves still share the bounded work queue with analysis. Separating
short operations from analysis, reducing repeated snapshot queries, and further
loading-state changes are subsequent stages; they are not claimed by this change.
