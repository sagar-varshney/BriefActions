# Responsive work and connection reuse

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

## Interactive work during analysis

Meeting reads, review saves, task updates and calendar/task/history views use a
reserved lightweight worker. Analysis, research operations and workspace exports
retain their own bounded lane. `FLOW_MAX_WORKERS` limits the analysis lane (one in
production); the interactive lane adds one serial Python process. Each lane has
at most ten waiting requests and a 15-second wait. Unknown operations default to
the analysis lane. This reserves capacity, not CPU or a guaranteed latency: both
lanes still share the free host and database, and writes may wait on account locks.

During a transcript extraction you can browse the main task, calendar and history
views. Opening another meeting and destructive account controls remain gated until
the extraction finishes. A completion notice opens the saved result; completion
does not redirect someone who has navigated away. Task saves immediately show a
pending message and acknowledge success only after storage confirms it. Existing
browser recovery and same-request retries remain available after a failure.

Loading a meeting now gets its events, series membership and replacement status
in one storage context, avoiding repeated connection/owner setup. These are still
separate SQL statements using the database's existing isolation level, not a new
cross-query snapshot guarantee. The browser shares simultaneous identical default
JSON GETs only. It copies results for each caller, discards completed requests,
invalidates sharing before and after writes, and rejects old-account responses.
Explicit request options and writes are never combined.

## Locating remaining delays

Production metrics retain histograms by fixed route and phase: `auth`,
`queue.analysis`, `queue.interactive`, `worker.analysis`, `worker.interactive`,
`storage_scope`, and `analysis_compute`. No transcript, owner, query, token or
account ID is included. Storage timings include connection setup, transaction
lifetime, commit/rollback and Python work inside a storage context; nested contexts
are counted once. Extraction compute covers the pipeline/imports and conversation
change extraction for a new analysis. It is absent on an idempotent replay and
does not measure research/model jobs. Worker time includes storage and compute,
so these overlapping histograms must not be added together.

Concurrency tests gate analysis and verify that reads/saves complete independently,
both queues are bounded, and failed work releases its slot. Browser tests cover
navigation during extraction, completion without redirect and truthful save
feedback. The 512 MiB / 0.1 CPU CI drill keeps one analysis and one interactive
worker resident, checks light reads/saves alongside a five-analysis burst, and records
peak memory, observed latency and whether the requests overlap the burst. A faster
completed burst does not fail CI; gated tests establish lane independence. The
seeded meeting warms the ML worker before
the burst; it is not a cold-start benchmark or a hosted latency promise.

These changes use the existing free services. They cannot remove the free host's
idle sleep/cold start or external authentication/network latency.
