# Productivity Flow Engine

[![CI](https://github.com/sagar-varshney/Productivity-Flow-Engine/actions/workflows/ci.yml/badge.svg)](https://github.com/sagar-varshney/Productivity-Flow-Engine/actions/workflows/ci.yml)

A React + Node.js local application that turns meeting transcripts into evidence-backed action
proposals, lets users correct or confirm them, and preserves the complete review
history. Extraction improvements are measured against a retained annotated corpus.

## Run locally

Use **Node.js 22.12+** and **pnpm 11+**, plus Python 3.10+ for the retained
extraction engine. React handles the interface; a Node HTTP API calls the Python
engine through a bounded JSON subprocess protocol. The extractor, annotated
evaluation set, prompts, measured reports, and SQLite event schema are unchanged.


```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pnpm install
pnpm dev
```

Open **http://127.0.0.1:5173**. The development API runs on port 3001;
Vite proxies `/api` requests to it. `pnpm dev` starts and stops both processes.
The loaded example uses its original meeting date (2026-09-15); set the actual
meeting date when pasting a new transcript.

For a built local app, run `pnpm build` then `pnpm start` and open
**http://127.0.0.1:3001**. `PORT=8765 pnpm start` changes the API/app port.
`PYTHON_BIN=/absolute/path/to/python3 pnpm dev` selects another interpreter;
otherwise `.venv/bin/python3` is preferred, with `python3` as fallback.
The macOS `run_local_4h.sh` helper now builds and serves this React application.
On this machine, **`./run_local.sh`** also starts development without adding tools
to your shell profile: the launchers reuse Codex's bundled Node/pnpm if installed
commands are unavailable. Python requirements must still be installed.

Paste a transcript, set its meeting date, and select **Analyze transcript**.
Inspect the exact supporting passages, edit tasks/owners/deadlines, select the
items to keep, and choose **Confirm selected tasks**. CSV export becomes available
for the confirmed plan. If an action is missing, use **Add a missed action**, highlight
the saved transcript, and enter task/owner/deadline fields (Unknown where absent).
The action is saved as a separate unchecked user-added proposal, while the original
extraction remains intact. Corrections, acceptance/rejection, and original passages
are retained; CSV identifies user-added tasks with `source=manual`. Duplicate actions
with compatible metadata are rejected; edit the existing proposal instead. Confirmed
plans cannot receive additions. Network retries reuse a stable request ID.
Confirmation saves a local plan; external task-system
integration is not implemented.

Missing owners and exact deadlines are explicitly `Unknown`. Vague timing stays
in the task wording. Every proposal includes character spans into the saved
transcript. Repeated tasks with compatible metadata are merged conservatively;
conflicting owners/dates remain separate for review. Broad semantic paraphrase
merging remains limited. Explicit deadline revisions and cancellations resolve only
unique named actions or immediate same-speaker references; ambiguous references
are recorded for review. Supporting original and revision passages are retained.

## Evaluation comes first

The retained starter corpus has **60 manually annotated synthetic transcripts**,
with 30 development and 30 held-out examples. Annotations are authored by Codex
and have not been independently reviewed. Related scenarios occur in both splits;
these measurements do not establish real-meeting or production accuracy.

Rules were improved on development cases, then frozen before held-out scoring.
On the held-out synthetic set:

| Metric | Original rules | Improved rules |
| --- | ---: | ---: |
| Task precision | 74.2% | 96.4% |
| Task recall | 79.3% | 93.1% |
| Task F1 | 76.7% | 94.7% |
| Owner accuracy on matched tasks | 87.0% | 100.0% |
| Deadline accuracy on matched tasks | 65.2% | 96.3% |
| Known-deadline end-to-end accuracy | 31.6% | 84.2% |
| Gold support proxy | 45.2% | 92.9% |

Task matching is lexical. Gold support checks task matching, exact gold metadata
and annotated evidence spans; it is not an entailment judge. Full counts,
per-transcript predictions, matches/misses, latency and reproducibility hashes
are retained under `evaluation/results/`.

Read [the retained model/rule comparison](evaluation/results/COMPARISON.md) and
[the annotation policy, scoring definitions and LLM comparison guide](evaluation/README.md).
The next evaluation milestone is independently annotated real meeting transcripts
and a fresh held-out split before further tuning from current test errors.

## Annotation review and fresh evaluation data

Open **Annotation reviewer** to import synthetic material or real transcripts you have
permission to use. Literal `original => alias` replacements are applied in the browser;
inspect the preview and confirm permission and a manual privacy check. Only the
preview reaches SQLite. There is no automatic guarantee that all identifiers are removed.

Select a case, enter your reviewer identity, and choose **Start or resume review**.
Select passages in the read-only transcript, add task/owner/deadline labels, and attach
additional passages for revisions. `Unknown` is explicit; evidence uses Unicode code-point
offsets. A reviewer starts with empty labels or resumes only their own draft. Unfinished labels,
selected passages, task/owner/deadline fields, and resolution notes save immediately
in browser storage, then to SQLite after a debounce. Drafts are isolated by case,
normalized reviewer identity, and review/resolution mode. Navigation and reload
restore the last reviewer session; independence must be attested again before submission.
Incomplete or invalid dates stay in the draft until corrected. Submitted reviews are
immutable and their drafts are cleared atomically; late autosaves cannot recreate them.
Stale writes from another tab are rejected, with the browser copy retained for explicit recovery. After submission, compare labels; disagreements are recorded and require
a resolution with an explanation before export. Reviewer identities are self-reported
on this local app, not authenticated, and the app cannot verify human independence.

Use **Review the existing evaluation corpus** to import all 84 bundled synthetic
transcripts, one corpus version, or an original split. Imports verify manifest hashes
and copy only transcript/date/source identifiers. Gold items and annotation rationale
are never copied into annotation storage or first-pass forms. Repeating an import
reuses cases by source ID or matching transcript and date. Filter/search cases by
corpus, original split, or text; the list is paginated. Imported source provenance
is retained in reviewed exports. The existing corpus files and reports stay unchanged.
Reviewing already evaluated cases does not make them unseen held-out data; reviewers
should avoid inspecting their original labels in the Evaluation lab. Reviewer identity
and independence remain self-attested, not authenticated access control.

Freeze agreed/resolved cases into seeded source-group splits; related meetings/scenarios
must use the same source group. Bundled inputs conservatively share one source group
per corpus version. Complete the reviews for all cases in a selected group before
freezing it, so unfinished members cannot later cross splits. Download dev/test JSONL, their hash manifest, or a
complete snapshot. Frozen cases cannot be relabeled. Existing snapshot IDs reload exports.
Use a fresh source group and a new snapshot for later evaluation rounds. Do not tune
on a held-out snapshot after inspecting its results.

No real transcripts were supplied for this update. **Revision v1 adds 24 manually
annotated synthetic transcripts**, with 12 development / 12 held-out cases, varied
meeting dates, leap/year boundaries, cancellation, ambiguous references, and deadline
changes. Labels were written before benchmark execution and were not independently
reviewed. Related linguistic patterns occur across splits; this is scenario validation,
not a blinded estimate of real-meeting accuracy. The 60-case starter corpus and its
retained reports remain unchanged. See [the new corpus manifest](evaluation/revision-v1/manifest.json).

Repeat development comparisons without overwriting retained reports:

```bash
python3 compare_models.py --config evaluation/repeated-local-models.json \
  --dataset evaluation/revision-v1/dev.jsonl --split dev \
  --output-dir evaluation/experiments/my-repeat-run
python3 compare_models.py --summarize-only --output-dir evaluation/experiments/my-repeat-run
```

Ollama must already be running with the configured models installed. Each pass retains
raw output, usage, actual model ID, code/prompt/data hashes, latency, cost and failures.
Fixed temperature 0 / seed 42 measure repeatability under those settings, not quality
across random seeds. Local API fees are zero; hardware/electricity costs are excluded.
Mean ± sample standard deviation is descriptive, not a confidence interval. Latency
includes adapter/startup/model-load time. Original and new corpus results are filtered
by dataset hash in the Evaluation lab so same-named JSONL files cannot be mixed.

## Benchmark frozen reviewed snapshots

Open **Evaluation lab → Benchmark reviewed snapshots** after freezing agreed or
resolved labels in Annotation reviewer. Select a snapshot and run the original
and current rules on the same inputs. **Development** is the default; scoring
held-out cases or both splits requires an explicit acknowledgment. Viewing test
errors makes them unsuitable for further tuning; prepare a new snapshot for later
validation. Previously evaluated bundled cases are identified and remain previously seen.

The comparison shows detection precision/recall/F1, owner/date accuracy on matched
actions, known-metadata end-to-end accuracy, exact-span validity, annotated support
proxy, latency, and failures. Inspect each transcript's frozen labels versus output,
including missed actions, extra predictions, wrong owners/dates and supporting spans.
Task matching is lexical and support is an annotated-span proxy, not semantic entailment.
Undefined metrics display Unknown. Reviewer identities and independence are self-attested.

Each comparison is saved locally in SQLite with the scored cases, gold labels,
per-case predictions/errors, snapshot manifest, and corpus/evaluator/extractor hashes.
Reload or select a saved comparison to reopen it; download the full JSON for analysis.
Original evaluation files, rule baselines and retained model reports are not rewritten.
No LLM or paid API call is made. Latency covers extraction only; zero API fees exclude
compute. A request supports at most 200 cases and 1,000,000 transcript characters.
Oversized reports are rejected before persistence. Retrying the same request ID
returns the existing comparison instead of adding another history record.

No independently reviewed human snapshot is fabricated by the app. The local library
starts with input-only synthetic cases; users must submit reviews and freeze labels
before this workflow can measure extraction against reviewed data.

## What the pipeline implements

- Evidence-grounded rule extraction for commitments and direct requests, with
  explicit unknowns and conservative deduplication.
- Editable review with unchecked acceptance controls and validation before the
  final local task plan is saved.
- SQLite history of input/reference date/settings, original proposals,
  per-item user decisions/corrections, and final results; complete JSON export.
  Confirmed results are immutable; analyze again to create another run.
- A frozen original-rule baseline, annotated dev/test splits, a scoring harness,
  two versioned LLM prompts, an Ollama adapter, and a model/prompt/repeat matrix.
- Extractive TF-IDF summary, TF-IDF/K-Means task groups, and Logistic Regression
  workstream classification on a small visible illustrative seed dataset.
- Deadline/urgency priority and deterministic schedule suggestions. These are
  heuristics, and classifier probabilities are not calibrated confidence in
  extraction accuracy. They are shown as proposal suggestions; final exports
  retain reviewed fields and evidence without stale derived suggestions.

Local transcript/history data is saved under ignored `data/history.sqlite3`.
History exports include the original transcript and user corrections. Existing
Streamlit-created history is readable without a database migration; old runs may
lack a saved summary. The last opened run is restored after a browser reload.
Unconfirmed task edits and acceptance selections autosave immediately in browser
storage, then to SQLite after a short debounce. Partial/invalid dates are preserved
for correction. Draft revisions reject stale writes from another tab; confirmation
still validates all fields and locks the final plan. `FLOW_HISTORY_PATH` overrides the database location.

## Web architecture

- `web/src/main.jsx`: React extraction/review, history, and evaluation screens.
- `web/src/styles.css`: responsive desktop/mobile layout and accessible form states.
- `server/index.mjs`: Node HTTP API, bounded Python workers, and built asset serving.
- `web_bridge.py`: JSON operations over the extraction/history and annotation modules.
- `vite.config.js`, `scripts/dev.mjs`: frontend build, dev proxy, and process lifecycle.

The API binds to localhost. It accepts JSON requests up to 1 MB and transcripts
up to 100,000 characters, with at most four concurrent Python workers and a
60-second worker timeout. Analyze explicitly creates a saved proposal run;
confirmation atomically records corrections/rejections and the final local plan.
Model experiments are inspected from retained files; the UI does not silently
run LLM calls. Python starts per API request, so cold import time affects web
latency; benchmark timings continue to describe extraction only.

| API | Purpose |
| --- | --- |
| `GET /api/health`, `/api/config` | Runtime readiness and sample input |
| `POST /api/runs` | Analyze `{transcript, reference_date, clusters}` |
| `GET /api/runs`, `/api/runs/:id` | List and inspect saved runs |
| `POST /api/runs/:id/manual-actions` | Add an evidence-backed user proposal with an idempotent request ID |
| `POST /api/runs/:id/draft` | Save incomplete edits with an optimistic draft version |
| `POST /api/runs/:id/finalize` | Save `{decisions}` with explicit acceptance |
| `GET /api/runs/:id/tasks.csv`, `/history.json` | Confirmed tasks and full audit exports |
| `GET/POST /api/annotations`, `GET /api/annotations/:id` | Import and inspect annotation cases |
| `GET /api/annotations/corpora`, `POST /api/annotations/import-corpus` | Verified, input-only bundled imports |
| `GET/POST /api/annotations/:id/draft` | Save/resume reviewer- and mode-specific partial labels |
| `POST /api/annotations/:id/submit` | Submit an independent review or reasoned resolution |
| `POST /api/annotations/freeze`, `GET /api/annotations/:snapshot/export` | Freeze grouped splits and export hashed files |
| `GET /api/reviewed-snapshots` | List frozen reviewed dataset manifests |
| `GET/POST /api/reviewed-benchmarks`, `GET /api/reviewed-benchmarks/:id` | Run/reopen local original/current rule comparisons |
| `GET /api/benchmarks`, `/api/benchmarks/:id` | Measured reports and annotated cases |

## Continuous integration

[GitHub Actions CI](https://github.com/sagar-varshney/Productivity-Flow-Engine/actions/workflows/ci.yml)
runs on pushes, pull requests, and manual dispatch. An Ubuntu 24.04
runner uses Python 3.13, Node.js 24, and pnpm 11.25.0 to install dependencies,
run Python tests, verify development extraction quality, test the Node API,
build React, and exercise the complete desktop/mobile browser workflow.
The workflow has a 20-minute timeout, a read-only repository token, and actions
pinned to verified release commits. New runs cancel older runs for the same ref.

The quality gate compares a freshly generated `rules/dev` report against
`evaluation/results/rules-dev.json`. All nine task, owner/date, and evidence
quality metrics must meet or exceed their retained values, every development
case must be present, and extraction failures must be zero. Corpus or scoring
fingerprint changes require an explicitly reviewed development baseline refresh;
CI also gates the new revision-v1 development set against its separate retained baseline.
CI does not rewrite retained reports. Latency/cost are recorded without unstable
machine-dependent thresholds. Held-out scoring and real LLM calls are not rerun.

Logs, the fresh development report, and synthetic browser screenshots are
uploaded as `ci-verification` artifacts (with the run attempt suffix) for seven
days, including on failures. Browser tests use temporary databases; local
transcript/history data is not uploaded. The pre-existing FastAPI/RAG backend
has separate dependencies and is outside these transcript-workflow checks.
Passing CI is reported on commits/PRs; branch protection is configured separately.

Run the development quality check locally:

```bash
python3 evaluate.py --extractor rules --split dev --output artifacts/rules-dev.json
python3 scripts/check_benchmark.py artifacts/rules-dev.json
```

Workflow setup follows the [GitHub Python CI guide](https://docs.github.com/en/actions/tutorials/build-and-test-code/python)
and [Playwright CI guide](https://playwright.dev/docs/ci).

## Tests and benchmarks

```bash
python3 -m unittest discover -s tests -v
pnpm test
pnpm build
# Python unittest also runs the three existing pipeline regression functions.
# Or, with pytest installed:
pytest -q

python3 evaluate.py --extractor rules --split dev --output artifacts/rules-dev.json
```

The tests cover extraction contracts, duplicate/conflicting tasks, date handling,
quote grounding, scoring failures, LLM runner protocol/cost, atomic history
transactions, Python bridge validation/legacy history, and HTTP analyze/review/
export/benchmark workflows. They do not make real model calls.

To compare local models and prompt versions, fill in the installed model names
in `evaluation/models.example.json` and run `compare_models.py`; see the guide.
The comparison measures `llama3.2:3b`, `qwen2.5:1.5b` and `qwen2.5:0.5b`, each
with two unchanged prompt versions on the frozen held-out corpus. Local model
IDs and experiment configuration are retained. The original held-out comparison has
one pass per combination. The new revision-v1 development matrix has three repeats
per model/prompt, with aggregate means, sample standard deviations, ranges, and
per-case failures. Model selection still needs independently labeled real data.
The app's Evaluation lab displays retained rule and measured LLM reports.

Browser workflow check (after the production build):

```bash
pnpm exec playwright install chromium
pnpm test:browser
```

This uses a temporary SQLite database and covers explicit acceptance, deduplication,
invalid date recovery, corrections, immutable confirmation, CSV/JSON downloads,
reload recovery, history, benchmark case inspection, empty plans, and mobile overflow.
`FLOW_SCREENSHOTS=/absolute/output/path` retains QA screenshots;
`FLOW_CHROMIUM_PATH=/absolute/path/to/chromium` reuses an installed browser.

## Project files

- `evaluation/dev.jsonl`, `test.jsonl`: transcript inputs and annotated gold items.
- `evaluation/corpus_manifest.json`: corpus provenance and SHA-256 fingerprints.
- `baseline_extractor.py`: frozen original extraction behavior.
- `extraction.py`: improved structured rules and evidence/deduplication contract.
- `evaluate.py`: task, metadata, evidence, latency, cost and failure measurement.
- `ollama_runner.py`, `compare_models.py`: actual LLM adapter and experiment matrix.
- `history.py`: append-only extraction, user-added proposals, decisions, and final plans.
- `reviewed_benchmarks.py`: frozen-snapshot scoring and local comparison persistence.
- `annotations.py`, `annotation_drafts.py`: immutable submitted reviews and separate mutable drafts.
- `corpus_library.py`: fingerprint-verified, input-only bundled corpus registry.
- `flow_engine.py`: existing ML classification/grouping and heuristic suggestions.
- `web/`, `server/`, `web_bridge.py`: React UI, Node API and Python bridge.

This remains an exploratory portfolio project. The workstream classifier uses
only a tiny illustrative training set; extraction is not trained by Logistic
Regression. Contextual handoffs, broad implicit revisions, paraphrases and mixed
negation require further work against new annotated evaluation data.

## Migration notes

Streamlit and `app.py` have been removed from the active application. Python is
still required for the tested extraction/evaluation/ML engine. No transcript
history or retained experiment results need conversion. React/Vite versions are
locked in `pnpm-lock.yaml`; use `pnpm install --frozen-lockfile` for repeat installs.
Build setup follows the [React Vite guidance](https://react.dev/learn/build-a-react-app-from-scratch)
and [Vite guide](https://vite.dev/guide/).

## Existing document/RAG backend

The repository's original FastAPI backend is preserved in `app/`. Its document
upload, client/workspace, RAG chat, authentication, and analytics code is separate
from the transcript workflow. The React UI uses the Node API described above;
it does not currently connect to these RAG endpoints.

See [the existing backend guide](docs/rag-backend.md). Its original pinned
requirements are preserved in `requirements-rag.txt`; install those separately,
preferably in a separate virtual environment, then run `uvicorn app.main:app --reload`
from the repository root. The root `requirements.txt` installs only the extraction
engine's Python dependencies. Existing backend implementation files are unchanged.
