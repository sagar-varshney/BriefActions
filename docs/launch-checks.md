# Hosting checks and private operational logs

The production default is **one Python analysis/export worker**, a queue of ten,
and a 15-second queue wait. Local development keeps two workers. This bounds
concurrent Python/ML memory on a small host; `FLOW_MAX_WORKERS=1..4` is available
for larger hosts after measuring their resource budget. Worker runtime remains
bounded at 60 seconds, and the client preserves request IDs for explicit retries.
Busy requests return HTTP 503 with `Retry-After: 2`; completed retries reuse the
original run. This does not promise that every simultaneous request is accepted.

## Health checks

- `/api/live` checks that the HTTP process responds. Render's Blueprint and the
  Docker health check use this fast endpoint. Database outages or a busy analysis
  queue do not cause the host to continually restart a responsive application.
- `/api/health` checks Python/ML dependencies on its first successful probe and
  the storage connection on subsequent probes. Probes share one in-flight promise
  and cache successful results for ten seconds. They run independently of the
  analysis queue. A small persistent Python checker handles later read-only storage
  probes, avoiding repeated interpreter/dependency startup under CPU limits. The
  checker has a five-second timeout, restarts after a failed process, and is stopped
  with the HTTP server. A failed probe returns an error, not a cached healthy value.

Liveness does not establish that analysis or storage is ready. Check `/api/health`
before opening the deployment to users, and monitor readiness separately from
automatic process restarts. The initial full probe can take longer on a cold,
CPU-limited host. Existing Render services must update their configured health
path to `/api/live`; editing the Blueprint does not change them retroactively.

## Fair limits behind a hosting proxy

The app applies 90 private API requests/minute and 10 analyses/minute to the
**verified account UUID**, not the shared proxy socket address. Different accounts
behind the same proxy or household network have separate quotas. Rotating an
access token or sending forged forwarding/account headers cannot reset the quota.

Before provider verification, a SHA-256 credential fingerprint is limited to 120
checks/minute. Only the hash is retained in the bounded, expiring limiter map;
credentials are not logged. At most eight provider checks run simultaneously.
Busy verification returns HTTP 503; expired/invalid sessions return HTTP 401.
Limit rejections include `Retry-After`. Raw forwarding headers are not trusted or
used for identity. This design needs no host-specific proxy trust configuration.

These limits are in-memory for a **single instance** and reset on restart. Provider
authentication/edge abuse controls still matter. Before scaling to multiple
instances, move account budgets to shared storage. A global capacity limit can
still reject work when the small host is full; account fairness is not unlimited
capacity or complete denial-of-service protection.

## Error references and telemetry

Every HTTP request receives a server-generated `X-Request-ID`. Error JSON also
includes `request_id`; the interface adds that reference to HTTP error messages.
Incoming request IDs are ignored. Network failures without a server response have
no server reference, and continue to use saved-request recovery.

Production enables `FLOW_TELEMETRY=true` by default. Host stdout receives JSON
`request_failure` records with time, reference, fixed route name, method, status,
duration, and an allowlisted category (for example `engine.busy`, `auth.unavailable`,
`worker.timeout`, `runtime.dependencies`, or `storage.failed`). Logs exclude
transcripts, request bodies, exception text/stack traces, full URLs/query strings,
file names, account/run IDs, email addresses, IP addresses, and auth/database secrets.
Python diagnostics are drained without forwarding private exception text.

Detailed failures are capped at 200/minute to bound log output. Counters still
include suppressed failures, and `suppressed_failure_logs` makes gaps inspectable.
Request references therefore support best-effort correlation, not a guaranteed
permanent audit log. User review history remains in account storage separately.

Once per minute, `runtime_metrics` records cumulative HTTP status/route counts,
a fixed latency histogram, active/queued workers, the worker limit, auth concurrency,
and Node RSS. Linux cgroup v2 deployments also report current **whole-container**
memory and its limit, including Python processes. Node RSS alone excludes Python.
The final histogram bucket counts requests above 90 seconds. Metric snapshots are
not per-request traces or extraction-quality measurements.

Use the hosting dashboard's logs to search a supplied reference and inspect its
category/status. Restrict access and choose host log retention appropriately.
`FLOW_TELEMETRY=false` disables these operational records. No external error
service, analytics tracker, notification automation, or public metrics endpoint is
configured by this feature.

## Constrained-container verification

CI builds the production image and runs:

```sh
FLOW_TEST_DATABASE_URL=postgresql://... pnpm test:hosting \
  --image flow-ci --output artifacts/hosting-load.json
```

Requires Docker, OpenSSL, and a **disposable local Postgres test database** with
all migrations already applied. Do not use production storage. The drill refuses
remote database hosts, starts a uniquely named container, and removes it afterward.
It generates a temporary HTTPS auth fixture and trusts its certificate only inside
that test container; TLS verification remains enabled. Temporary credentials/key
files are private and removed, and only reports/sanitized logs become artifacts.

The container has **512 MiB memory, no additional swap, and 0.1 CPU**, with one
worker. Five synthetic analyses arrive together, including an approximately 18k
character transcript. Queue rejections are explicitly retried. The checks cover:

- Startup readiness, authenticated analysis and rejection of unauthenticated access.
- Exact supporting passages, owner/date output, account isolation, and idempotent retries.
- Successful liveness/readiness responses while analysis is busy.
- Whole-container peak memory, no OOM kill, and latency observations.
- Absence of fixture transcripts, tokens, and database credentials in container logs.

The JSON report records observed startup time, successful-analysis p50/p95/max,
burst statuses, retries, health timings, peak memory, and completion/failure. For
five samples, percentiles are descriptive observations, not service-level promises.
An overload response is acceptable; lost/duplicate data, broken evidence, failed
health checks, and OOM kills fail the drill. GitHub retains reports for seven days.

This measures a bounded synthetic workload in a constrained container with local
Postgres and auth fixtures. Real Render cold starts, Supabase network latency,
OAuth redirects, user counts, and live backups still require a deployment check.
See [Render compute plans](https://render.com/docs/compute-plans),
[Render proxy behavior](https://render.com/articles/how-render-handles-ddos-attacks),
and [Docker resource constraints](https://docs.docker.com/engine/containers/resource_constraints/).

## Final live verification

Once hosting and Supabase are configured, verify GitHub sign-in/expiry/sign-out,
two-account isolation, history after redeploy, and `/api/health`. Enable the backup
secrets/variable, run a backup, and test restoration into an isolated empty database.
Neither credentials nor live deployment configuration are supplied automatically.
Follow [deployment setup](deployment.md) and [backup recovery](backups.md).

## Follow-up plan review

With two real hosted accounts, confirm that only the owner can compare a follow-up,
restore its review draft, confirm changes, or export either plan version. Check that
unapproved changes retain old tasks, All tasks shows only the current version,
and task progress carries over. Submit competing drafts in separate tabs; only
one may replace the same base plan. Erase the original input and verify that later
versions containing its source disappear too, including after a backup restore
with a fresh erasure ledger. Apply migration `004_plan_updates.sql` before this check.
