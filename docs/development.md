# Developing BriefActions

For installation, see [Run locally](../README.md#run-locally). For everyday use,
see the [user guide](user-guide.md). This reference describes the active React,
Node, and Python application.

## Architecture

```text
React / Vite → Node HTTP API → Python bridge → extraction and history
                                    └──────→ annotation and evaluation
                                               ↓
                              SQLite locally / Postgres when hosted
```

| Location | Responsibility |
| --- | --- |
| `web/src/main.jsx`, `web/src/styles.css` | Public homepage, sign-in, private workspace, themes, and responsive UI |
| `server/` | HTTP routes, authentication, request limits, worker lifecycle, and built asset serving |
| `web_bridge.py`, `export_bridge.py` | JSON worker protocol and streaming workspace export |
| `extraction.py`, `baseline_extractor.py` | Current evidence-backed rules and frozen original rules |
| `flow_engine.py` | Summaries, task groups, workstream classification, and heuristic suggestions |
| `plan_updates.py` | Conservative follow-up comparisons, versioned change review, atomic plan replacement, and progress carryover |
| `followup_drafts.py`, `weekly_review.py` | Versioned follow-up messages and timezone-aware weekly snapshots |
| `history.py`, `task_dashboard.py` | Saved runs, drafts, decisions, progress, and cross-meeting task search |
| `annotations.py`, `annotation_drafts.py`, `corpus_library.py` | Review submissions, autosaved labels, and verified input-only practice imports |
| `reviewed_benchmarks.py`, `evaluate.py` | Frozen-snapshot comparisons and extraction scoring |
| `ollama_runner.py`, `compare_models.py` | Explicit model/prompt/repeat experiments |
| `evaluation/` | Versioned datasets, manifests, prompts, and retained reports |
| `deploy/`, `scripts/backup.py` | Hosted migrations, deployment support, and encrypted recovery |
| `tests/`, `.github/workflows/` | Workflow checks and CI automation |

The Node server calls a bounded pool of serial Python workers, started lazily and
reused after a response. Imports stay warm; each request gets its own history and
verified account scope. PostgreSQL connections are cached within each worker,
with a fresh transaction, role, owner and deletion guard on every checkout.
Crashes/timeouts discard the worker without automatically replaying an accepted
write. Exports and initial deep readiness still use dedicated subprocesses.
See [performance verification](performance.md) for the local before/after drill
and its limits. Model reports are loaded from retained results; the UI does not
trigger paid or local LLM calls.

The Python pipeline also offers TF-IDF summaries, TF-IDF/K-Means task grouping,
and a Logistic Regression workstream classifier trained on a small illustrative
seed. Extraction itself uses rules. Classifier probabilities and priority/schedule
heuristics are not calibrated extraction confidence. Confirmed exports retain the
reviewed task fields and evidence, rather than stale derived suggestions.

## Local settings

| Setting | Behavior |
| --- | --- |
| `PYTHON_BIN` | Explicit Python executable; otherwise `.venv/bin/python3`, then `python3` |
| `PORT` | API/built-app port, default `3001`; the development frontend uses `5173` |
| `FLOW_HISTORY_PATH` | Override the local SQLite path, default `data/history.sqlite3` |
| `FLOW_MAX_WORKERS` | Analysis lane concurrency: two locally, one in production; a separate lightweight lane adds one worker |
| `FLOW_CHROMIUM_PATH` | Reuse a browser executable for browser checks |
| `FLOW_SCREENSHOTS` | Directory for synthetic browser QA screenshots |

`pnpm dev` starts and stops Vite and the API together. `pnpm build` writes `dist/`;
`pnpm start` serves that build through Node. Keep local previews on loopback.
The optional `run_local.sh` and macOS `run_local_4h.sh` launchers reuse installed
Node/pnpm or the bundled desktop runtime when available.

Public hosting uses server-side Supabase and Postgres configuration; follow the
[deployment guide](deployment.md) rather than using local auth on a public host.
`.env.example` contains production placeholders, not working development credentials.
Never expose secret keys or a database URL through React build variables.

## Routes and access

Public browser routes are `/`, `/sign-in`, `/auth/callback`, and `/privacy`.
Workspace routes are `/meetings`, `/meetings/:id`, `/tasks`, `/history`, `/account`,
`/research/evaluation`, and `/research/annotations`. A meeting link can include
`?task=<proposal-id>`. Sign-in preserves recognized same-origin destinations;
signing out clears that destination. Hosted access is verified at the API, not
only by hiding UI controls.

The server binds to loopback locally and the configured host in production.
Ordinary JSON requests are limited to 1 MB and transcripts to 100,000 characters.
Workers have a 60-second timeout. Account authentication and usage limits are
bounded separately. See [launch checks](launch-checks.md) for readiness, telemetry,
and production resource verification.

### HTTP API reference

Hosted requests require a verified bearer token except for `/api/auth-config`,
`/api/live`, and `/api/health`. These public endpoints return configuration or
health status, not private records. All other hosted data is account-scoped.
Request schemas and validation are implemented in [server/index.mjs](../server/index.mjs)
and [web_bridge.py](../web_bridge.py).

| Method and path | Purpose |
| --- | --- |
| `GET /api/auth-config` | Public sign-in mode, provider URL, publishable key, and email availability |
| `GET /api/live`, `GET /api/health` | Process liveness and runtime/storage readiness |
| `GET /api/config` | Workspace configuration and synthetic sample input |
| `POST /api/runs` | Analyze `{transcript, reference_date, clusters, request_id, title}`; matching retries reuse the saved result |
| `GET /api/runs`, `GET /api/runs/:id` | List and inspect saved runs |
| `GET /api/runs/search` | Paginated meeting-name/transcript search, date range, and review status |
| `GET /api/owners` | Account-scoped owner-label groups, summary counts, and one priority task per group. Requires device `today`; optional `query` (200 characters), `view` (open/all/overdue/unassigned), `page`, and `page_size` (1–50). |
| `GET /api/tasks` | Paginated confirmed-task search and date/progress views; requires the device's `today` date; optional exact `owner` label (`Unknown` selects missing owners) |
| `GET /api/today` | Private daily overview. Requires device date `today` (YYYY-MM-DD); optional preview `limit` (1–12, default 4). Complete counts and bounded previews for overdue, today, next-seven-day tasks and unfinished reviews, plus open/undated totals. |
| `GET /api/weekly-review` | Timezone-aware recent completions and current overdue/upcoming/review counts, with paginated lists |
| `POST /api/runs/:id/followup-draft` | Versioned follow-up subject/message, stable retries, and source-freshness checks |
| `GET /api/calendar` | Account-scoped month counts, selected-day entries, and global undated tasks. Requires `month` (YYYY-MM); optional `day`, `kind` (all/meetings/tasks), `status` (open/empty/todo/in_progress/done), `page`, `unscheduled_page`, and `page_size` (1–50, default 12). |
| `POST /api/runs/:id/updates` | Create/recover a follow-up comparison using `{transcript, reference_date, request_id}` |
| `POST /api/runs/:id/update-draft` | Save `{decisions, version}` for a comparison without changing the active plan |
| `POST /api/runs/:id/update-confirm` | Approve selected changes atomically and replace the previous active version |
| `POST /api/runs/:id/title` | Versioned, audited meeting rename |
| `POST /api/runs/:id/deadline` | Versioned, retry-safe `{proposal_id, deadline, reason, version, request_id}` correction. Date must be YYYY-MM-DD or Unknown; reason is required (1–500 characters). |
| `POST /api/runs/:id/progress` | Retry-safe `{proposal_id, status, version, request_id}` update, separate from the confirmed plan |
| `POST /api/runs/:id/manual-actions` | Add an evidence-backed proposal before confirmation |
| `POST /api/runs/:id/draft` | Save incomplete decisions with an optimistic draft version |
| `POST /api/runs/:id/finalize` | Validate decisions and confirm the selected plan |
| `GET /api/runs/:id/tasks.csv`, `GET /api/runs/:id/history.json` | Confirmed tasks and complete run activity exports |
| `GET /api/account`, `GET /api/account/export` | Account lifecycle/storage usage and streaming workspace JSONL export |
| `POST /api/account/delete` | Confirmed workspace erasure and hosted sign-in account deletion |
| `POST /api/runs/:id/delete`, `POST /api/annotations/:id/delete` | Confirmed permanent input erasure |
| `GET /api/annotations`, `POST /api/annotations`, `GET /api/annotations/:id` | List, import, and inspect example cases |
| `GET /api/annotations/corpora`, `POST /api/annotations/import-corpus` | Verified, input-only bundled imports |
| `GET /api/annotations/:id/draft`, `POST /api/annotations/:id/draft` | Reviewer- and mode-specific unfinished labels |
| `POST /api/annotations/:id/submit` | Submit a review or reasoned disagreement resolution |
| `POST /api/annotations/freeze`, `GET /api/annotations/:snapshot/export` | Freeze grouped splits and export a snapshot |
| `GET /api/reviewed-snapshots` | Frozen reviewed dataset manifests |
| `GET /api/reviewed-benchmarks`, `POST /api/reviewed-benchmarks`, `GET /api/reviewed-benchmarks/:id` | List, run, and reopen original/current rule comparisons |
| `GET /api/benchmarks`, `GET /api/benchmarks/:id` | Retained method reports and annotated cases |

## Persistence and review rules

Original extraction events and confirmed plans remain unchanged. Follow-up comparisons
store their source link and before/after rows in the new extraction event. Versioned
`plan_update_draft` events retain choices and corrections; `plan_update_review`
records confirmation. A `plan_superseded` event removes the old plan from All tasks
without rewriting its final result. Confirmation and retained-task progress carryover
share the account write lock; another draft cannot replace that same version again. Review corrections,
manual proposals, renames, and progress have separate saved records. Autosaved
review drafts use optimistic versions to reject stale writes. Matching analysis
and progress request IDs recover saved results without duplicating an operation.

Local data lives in SQLite; hosted account data lives in Postgres. Review drafts,
annotation drafts, frozen snapshots, and saved comparisons use the configured
storage. Browser-only input drafts are not cross-device data or part of workspace
exports. Older Streamlit-created history remains readable; old records may lack a summary.

Annotation reviewer names and independence are self-attested within an account;
separate names do not establish independent human review. Real transcripts require
permission and a manual anonymization check. Previously evaluated bundled cases
remain previously seen after importing or relabeling them. Frozen reports preserve
inputs, labels, predictions, errors, and reproducibility hashes. See the
[evaluation guide](../evaluation/README.md) for the annotation and scoring policy.

## Verification

Run unit/API checks, the production build, and browser workflows:

```bash
python -m unittest discover -s tests -v
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:browser
```

Browser suites use temporary databases and synthetic data. On a Linux CI host,
Playwright uses `pnpm exec playwright install --with-deps chromium` to include
system dependencies. `FLOW_SCREENSHOTS` retains screenshots; `FLOW_CHROMIUM_PATH`
selects an existing executable.

Run both development quality gates without changing retained results:

```bash
python evaluate.py --extractor rules --split dev --output artifacts/rules-dev.json
python scripts/check_benchmark.py artifacts/rules-dev.json
python evaluate.py --extractor rules --dataset evaluation/revision-v1/dev.jsonl \
  --split dev --output artifacts/revision-dev.json
python scripts/check_benchmark.py artifacts/revision-dev.json \
  --dataset evaluation/revision-v1/dev.jsonl \
  --baseline evaluation/results/revision-v1/rules-dev.json
```

Real-Postgres tests require an isolated disposable database configured through
`FLOW_TEST_DATABASE_URL`. The workflow scripts apply migrations and use test data;
never point them at a live application database.

```bash
python scripts/test_postgres.py
python scripts/test_backup_postgres.py
```

For production-image resource tests, see [launch checks](launch-checks.md).
For explicit model experiments, see [evaluation](../evaluation/README.md).

### Continuous integration

[CI](https://github.com/sagar-varshney/BriefActions/actions/workflows/ci.yml) runs on
pushes, pull requests, and manual dispatch using Ubuntu 24.04, Python 3.13,
Node.js 24, and pnpm 11.25.0. It checks:

- Python extraction, evidence, date, history, annotation, and evaluation contracts.
- Real Postgres account isolation, erasure permissions, and encrypted backup/restore.
- Both development extraction baselines, including corpus/scorer fingerprints and zero failures.
- Node API workflows, authentication, data controls, and interrupted-request recovery.
- The React build and desktop/mobile browser suites, including keyboard and axe accessibility checks in both themes.
- The production Docker image and its 512 MiB / 0.1 CPU resource profile.

The quality gates require task, owner/date, and evidence metrics to meet their
retained development values. Fingerprint changes need a reviewed baseline refresh.
Latency and cost do not have unstable machine-dependent thresholds. Held-out
scoring and real model calls are not run in CI.

Reports, logs, and synthetic screenshots are retained as `ci-verification` artifacts
with a run-attempt suffix for seven days, including on failure. New runs cancel
older runs on the same ref. The workflow has a 20-minute timeout, read-only
repository permissions, and pinned action revisions. Branch protection is a
separate repository setting. Automated accessibility checks supplement manual
screen-reader and usability review; they do not certify complete WCAG conformance.

## Workspace entry routing

`/workspace` is an authenticated entry route, not a saved section. It checks the
account state, then reads one page of saved-meeting history (`page_size=1`). An
empty workspace opens `/meetings`; an account with saved meetings opens `/today`.
Accounts with pending deletion open `/account`. The public homepage does not make
these private requests. Explicit section, meeting, and task links bypass this
default selection, and authentication redirects still discard untrusted queries.
A failed entry check offers a read-only retry rather than guessing a destination.


## Deadline correction projection

`task_deadlines.py` appends `task_deadline` events under the account write lock.
Optimistic versions are per task and separate from progress. A reused request ID
recovers the original write without rolling back later changes. New writes to
unconfirmed, superseded, deleted, or another account’s tasks are rejected.

Run snapshots keep immutable `final_tasks` and add `current_tasks` and
`task_deadlines`. The shared SQLite/Postgres task projection applies the latest
correction for Calendar, My day, and task search. CSV includes `confirmed_deadline`
and `deadline_correction_reason`; readable plan exports identify the correction.
Follow-up comparisons snapshot deadline versions. Confirmation rechecks those
versions atomically, so a stale comparison cannot overwrite a newer correction.
Inherited corrected dates retain their reason until a reviewed follow-up changes
that date. No schema migration or new service is required.


## Owner workload projection

`owner_overview.py` aggregates the shared current-task projection in one read-only
SQLite/Postgres statement. Only confirmed, unsuperseded plans contribute. Deadline
corrections and latest progress are included. The query clamps pagination and
returns at most `page_size` groups and one priority open task per returned group;
complete counts cover the matching groups, not just the page. Responses contain
no transcript or evidence text. `/owners` is an ordinary authenticated workspace
route and retains its destination through sign-in.

Names group by their exact trimmed label; case variants are distinct except for
the reserved Unknown label. Unknown/blank values form one Unassigned group. The
`owner` task-search filter uses the same exact grouping and never changes auth
scope. The filter is held in workspace state and is cleared by Show all owners;
owner names are not added to browser-history URLs. No account mapping, owner
merging, or automatic assignment is performed.

## Separate legacy backend

The preserved FastAPI/RAG code in `app/` has its own `requirements-rag.txt` and
[backend guide](rag-backend.md). It is not used by the BriefActions React UI or
covered by these transcript-workflow CI checks. Use a separate Python environment
for its dependencies.

## Follow-up messages and weekly reviews

`POST /api/runs/:id/followup-draft` accepts `subject` (1–300 characters, one line),
`body` (1–100,000 characters), optimistic `version`, `source_revision`, and a stable
32-character hex `request_id`. `followup_drafts.py` saves `followup_draft` events
under the existing account write lock. Confirmed task/evidence events stay intact.
Retries recover their original write, while snapshots return the newest saved
message. Stale versions, changed source details, unconfirmed/superseded plans,
and foreign/deleted inputs cannot receive new message edits.

Run snapshots expose `followup_draft` and `followup_revision`. The SHA-256 revision
covers the current title, meeting date, effective tasks, progress, and supersession
state; message saves do not invalidate it. The plain-text message template runs
in the browser and uses confirmed fields only. Unsaved edits and pending requests
use the existing account-scoped browser storage, additionally keyed by tab client
and meeting. Explicit Save syncs a version to the server. Copy rechecks freshness;
regeneration requires an explicit replacement action. There is no email transport,
external language-model call, or new schema migration.

`GET /api/weekly-review?today=YYYY-MM-DD&time_zone=IANA_ZONE&view=completed&page=0&page_size=8`
requires a valid device date, accepts `completed`, `overdue`, `upcoming`, or `reviews`,
and returns complete counts with bounded items (maximum 50). It is a read-only,
account-scoped, single-statement SQLite/Postgres projection of current plans.
Completion times use seven local calendar dates, converted to UTC boundaries by
`zoneinfo`; `tzdata` supplies portable IANA data, including in the Docker image.
A recursive projection follows inherited progress events' `carried_from` chain to
its original timestamp, so plan replacement cannot manufacture a new completion.
Currently reopened tasks are excluded. Overdue/upcoming counts use current dates;
unfinished reviews are not restricted to the completion window. Neither endpoint
logs message text or query parameters. Events participate in existing exports,
encrypted backups, storage quotas, account separation, and erasure.

`tests/test_followup_drafts.py` and `tests/test_weekly_review.py` run on SQLite and
real Postgres in CI. API and browser checks cover concurrency, source freshness,
lost-response recovery, time-zone/DST boundaries, copied plan history, complete
pagination, plain-text clipboard fallbacks, and both-theme responsive accessibility.

## Meeting series and preparation

Series live under `/history/series` and `/history/series/:id`; Meeting history keeps
its existing navigation position. These routes retain their destination through
sign-in and browser history. Saved meetings expose `series_membership` (root ID,
optimistic version, and current series). A recursive, account-scoped lineage query
inherits membership from the original extraction across reviewed follow-ups.
`meeting_series_link` events are appended only to the root, never to task plans.
Standalone analysis accepts optional `series_id`; extraction and its initial link
commit atomically, and the analysis fingerprint includes the initial group choice.
Matching retries cannot undo a later membership change. Existing ungrouped
fingerprints are unchanged.

`meeting_series.py` implements:

| Method and path | Purpose |
| --- | --- |
| `GET /api/series` | Literal name search, complete counts, bounded pages (maximum 50 groups) |
| `POST /api/series` | Create `{name, request_id}` with a stable ID and case-insensitive duplicate-name check |
| `GET /api/series/:id` | Private current name/version metadata |
| `POST /api/series/:id/name` | Versioned, retry-safe `{name, version, request_id}` rename |
| `POST /api/runs/:id/series` | Versioned, retry-safe root membership `{series_id: id or null, version, request_id}` |
| `GET /api/series/:id/preparation` | Requires device `today`; `view` is tasks/meetings/changes/agendas, with bounded pagination (maximum 12 items) |
| `POST /api/series/:id/agenda` | Save `{subject, body, version, source_revision, today, request_id}` |
| `GET /api/series/:id/agendas/:version` | Inspect one retained agenda version |
| `POST /api/series/:id/delete` | `DELETE SERIES` erases group metadata/agendas and keeps conversations |

Preparation reads one SQLite/Postgres statement with no transcript or evidence
text in its result. Task metadata uses the shared effective-task projection;
replaced plans and Done tasks do not add open work. All lightweight source rows
are considered to create a complete agenda (maximum 100,000 characters); API
items remain paginated. Oversized suggestions are explicitly unavailable, with a
blank-editor option. Updates are confirmations, deadline changes, and non-inherited
progress changes after the last available agenda's source high-water event ID.
Agenda history lists metadata and loads a selected body's version separately.

Source hashes include the device date, source-event IDs, current membership/name,
and the account's erasure generation (deleted-input count). Agenda saves recheck
that hash and an optimistic version under the account write lock. Saved text uses
`series_agenda` events; non-content `series_agenda_saved` markers keep versions
monotonic after body erasure. The browser caches unsaved text and exact pending
requests per account/tab/series. Cached text retains source IDs for erasure.
A group deletion preserves unrelated unsubmitted transcript text, clearing only
its series choice; committed analysis retries keep their original fingerprint.

Every saved agenda retains dependencies on current and historical source families
in its series. This deliberately errs toward removing copied material when a
source is erased after a membership move. Migration `005_series_agenda_erasure.sql`
extends the owner-scoped purge function and supplies a readiness marker. Agenda
saves and hosted storage readiness require it. SQLite applies equivalent purge
behavior directly. Series deletion keeps only membership IDs in existing meeting
history, not the deleted name or agenda text. Standard exports, encrypted backups,
row security, and account storage limits cover the new events. The real-Postgres
backup drill verifies both retained agendas and removal of agenda copies when
applying a newer erasure ledger to an older encrypted backup.

## Extraction and review audit

`evaluation/audit-v1/` contains a frozen 28-case synthetic development set and
retained before/after rule reports. The generator specifies labels directly and
never calls extraction. CI checks its quality floor alongside starter and
revision development floors; none of these jobs score reserved test data or call
models. See the [audit report](../evaluation/audit-v1/README.md) for fingerprints,
commands, observed results, and remaining limits. A targeted perfect development
score is not a general accuracy estimate.

New plan comparisons record a combined `extractor_sha256` and
`extractor_components` for both `plan_updates.py` and `extraction.py`. Existing
saved comparisons and request retries retain their original settings. The review
browser audit covers new wording, keyboard repair of an empty extraction,
evidence offsets, Unknown metadata, and explicit confirmation on narrow screens
and in both themes. It runs last in `pnpm test:browser`.
