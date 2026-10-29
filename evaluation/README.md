# Extraction benchmark and annotation guide

The [28-case development audit](audit-v1/README.md) adds targeted regression
coverage and retained before/after reports. It has no held-out split and does not
replace or rescore the reserved starter/revision corpora described below.

The [30 October expanded regression contracts](../tests/fixtures/README.md)
retain 74 additional synthetic probes from the subsequent exploratory audit.
Python and API tests cover all cases; extra history and browser tests protect
Unicode task identity, merged references, uncertain dates, conditional work and
speaker case matching. These are development checks, not a new held-out score.

Version 1 contains **60 synthetic transcripts** and **57 gold action items**:
30 development transcripts / 28 items and 30 held-out transcripts / 29 items.
Codex authored the transcripts and specified the annotations directly; labels
were not generated from extractor predictions. They have **not been independently
human-reviewed**. The split is hand-selected, with related scenarios across both
splits; it is not a representative real-world sample or a blinded evaluation.

The first 20 examples per split cover explicit commitments, speaker ownership,
unknowns, requests, duplication, negative/status/hypothetical statements, invalid
calendar dates and relative deadlines. The remaining 10 include multi-turn
handoffs, paraphrases, deadline revisions, cancellations, quoted examples,
contractions, joint owners and conflicting assignments.

Tune rules/prompts on `dev.jsonl`. Freeze implementation and prompt versions
before scoring `test.jsonl`. The retained rules were improved using development
feedback; held-out errors were recorded without further extraction changes.
If future changes use these test errors, treat this split as development data
and author a new held-out split. `build_seed.py` records the annotation authoring
choices; it is not a runtime labeling pipeline.

## Annotation policy

For each transcript, record the meeting's `reference_date`, transcript ID,
source/provenance and split. For every actionable commitment/direct request:

1. Write a concise task description. Keep compound work together when one
   owner/deadline applies to the whole commitment.
2. Record the named owner or `Unknown`. First-person commitments belong to the
   speaker; plural "we" does not imply individual speaker ownership. Preserve
   explicitly named joint owners as one string (e.g. `Maya and Arjun`).
3. Record an ISO deadline or `Unknown`. Today/tomorrow and "in N days" use the
   meeting date. A bare weekday is the next occurrence including today; "next
   weekday" is in the following Monday-based calendar week. End of week means
   Friday. Week/month intervals and ambiguous numeric dates remain unknown.
   Preserve their wording in the task. Invalid dates remain unknown.
4. Cite exact supporting passages as `{text, start, end}` using Python Unicode
   character indexes, starting at zero with an exclusive end. Evidence must
   support the action/metadata, not merely contain similar words.
5. Merge repeated commitments with compatible assignments and dates; keep every
   evidence occurrence. Preserve unresolved conflicting assignments separately.
   Apply explicit subsequent cancellations or revisions, citing the initial
   commitment and revision together. Exclude completed/hypothetical/status work.

Before using real transcripts, obtain permission to use them, remove unnecessary
personal information, keep all fragments of one meeting in the same split, and
reserve whole meetings before tuning. Have a second annotator label a sample
independently, adjudicate disagreements, and retain annotation revisions and
reviewer identities. Real data can live in ignored `evaluation/private/`.
The starter set has no inter-annotator agreement or statistical uncertainty claim.
All scored examples use the same reference date (2026-09-15); expand date/time
contexts and meeting domains in the next independently annotated corpus.

## Scoring

```bash
python3 evaluate.py --extractor baseline --split dev --output evaluation/results/baseline-dev.json
python3 evaluate.py --extractor rules --split dev --output evaluation/results/rules-dev.json
python3 evaluate.py --extractor baseline --split test --output evaluation/results/baseline-test.json
python3 evaluate.py --extractor rules --split test --output evaluation/results/rules-test.json
```

`baseline_extractor.py` freezes the original detection/owner/date/priority rules.
For scoring only, its missing labels are mapped to `Unknown` and the sentence it
selected is attached as evidence. Its extraction behavior is otherwise unchanged.

On 30 October 2026, `results/rules-dev.json` was refreshed after fixing the
development case `dev-26` (“Move my … deadline to Monday instead”). The unchanged
30-case development set now meets 1.0 on all nine CI quality metrics, strengthening
the retained regression floors. Unit and API tests additionally require both
supporting passages and explicit confirmation before calendar updates. Reserved
test reports and model comparisons remain historical; they were not rerun or
used to tune this fix. These synthetic development scores are not real-meeting
accuracy estimates.

Task matching uses a maximum-cardinality one-to-one assignment, then lexical
similarity. Eligible pairs require at least 60% of gold content tokens and 45%
of predicted content tokens to overlap; dates and a fixed filler-word list are
excluded. Exact evidence spans break ties between otherwise identical tasks.
Owner/date correctness does not influence matching. This matching is an
inspectable approximation and can miss paraphrases or accept underspecified
tasks; human semantic adjudication remains necessary.

- **Task precision/recall/F1:** pooled item counts across transcripts. Duplicate
  predictions can match only once and lower precision.
- **Owner/date accuracy on matched tasks:** exact metadata agreement (case folded
  for owners), including correct `Unknown` predictions. These conditional
  accuracies can be high even when task recall is low.
- **Known-owner/known-deadline end-to-end:** correct matched values divided by
  all gold known values. Missed tasks count against these metrics.
- **Evidence validity:** all quotes reproduce valid original character spans.
- **Gold support proxy:** a task match, correct gold owner/date, and every cited
  span inside that gold action's annotated passages. This is **not semantic
  entailment**. False positives and missing evidence fail the proxy. It does
  not verify that all gold passages needed for a multi-turn inference were cited.
- **Failures:** failed requests/schema validations count as empty predictions;
  those gold items still lower recall. Reports retain failure types, invalid
  items/JSON responses when available, and raw valid model responses.
- **Latency:** wall-clock extraction latency per transcript. For LLMs this includes
  the runner process, service loading, generation and validation. Rules timing
  excludes classification/grouping/scheduling. p50/p95 use nearest ranks;
  single runs are exploratory timings, not a performance guarantee.
- **Cost:** API charge from reported usage and supplied per-million token prices.
  Missing usage/prices remain unknown. Local Ollama reports zero API fees;
  hardware/electricity and failed requests with unreported usage are unmeasured.
  An aggregate cost is unknown if any transcript's cost is unknown.

Reports preserve each input ID, predictions, matches/misses, dataset SHA-256,
extractor/evaluator hashes, prompt version/hash, actual model IDs, usage,
generation settings and runner hash (when supplied). Dataset files retain inputs.
`corpus_manifest.json` freezes the corpus hashes and provenance.
Run `python3 evaluation/summarize_results.py` to regenerate the Markdown comparison
from retained reports; it refuses to mix different corpus fingerprints.

## LLM comparison

`ollama_runner.py` implements an actual LLM extractor against an existing local
model, using the [Ollama generation API](https://docs.ollama.com/api/generate) and
[structured output schema](https://docs.ollama.com/capabilities/structured-outputs).
It asks the model for task/owner/deadline and verbatim quotes, then derives quote
offsets deterministically. Quotes absent from the transcript fail validation.
This avoids making the model count characters. Temperature is 0, seed is 42, and the output limit is 1,024 tokens;
these settings do not guarantee full determinism on every backend. The runner
never downloads models automatically.

```bash
python3 evaluate.py --extractor llm --split dev --prompt v2 \
  --label my-model-v2 --llm-command 'python3 ollama_runner.py --model YOUR_INSTALLED_MODEL' \
  --output evaluation/experiments/my-model-v2-dev.json
```

For several models × two prompt versions × repeated runs, copy
`models.example.json`, replace every placeholder with a model already available
locally, and run:

```bash
python3 compare_models.py --config evaluation/my-models.json --split dev \
  --output-dir evaluation/experiments/comparison-001
```

Select candidates on development quality, failures, latency and cost. Then
freeze those choices and score a new held-out split. The matrix keeps individual
reports and a summary CSV and refuses to overwrite existing reports. It does not
silently pick a winner from held-out performance.

For a hosted provider, supply your own executable adapter: it reads one JSON
request on stdin (`prompt`, `transcript`, `reference_date`, `response_contract`)
and writes JSON on stdout with `items`, actual `model`, and optional
`usage: {input_tokens, output_tokens}` / `cost_usd`. Items must contain exact
span evidence and explicit unknowns. Never print credentials to stdout.
Use `--input-usd-per-million` and `--output-usd-per-million` with verified provider
prices, or the equivalent fields in the matrix config. Do not run adapters on
private transcripts unless the provider/data handling is authorized.

The retained comparison uses three local models: `llama3.2:3b`,
[`qwen2.5:1.5b`](https://ollama.com/library/qwen2.5:1.5b), and
[`qwen2.5:0.5b`](https://ollama.com/library/qwen2.5:0.5b), each with both prompt
versions on the same held-out corpus. Qwen models were downloaded with approval.
`local-model-run.json` records the exact experiment commands; `model_inventory.json`
records the installed model IDs. Each combination has one pass; these are small
local-model screening results, not a universal ranking or a robust latency study.
Adapter fixture tests are labeled fixtures and are not model-quality results.

Preliminary runs omitted the ISO date constraint in the adapter's model schema.
Those scores are archived under `superseded-contract-v1/`, excluded from the app
and final comparison. The corrected adapter restores the specified output
contract and retains invalid quotes/raw outputs for diagnosis. Every final
comparison was rerun under the corrected adapter, with unchanged corpus and
versioned prompt files. The held-out split was inspected while debugging the
adapter contract; stronger future validation needs a fresh independently authored
split. Semantic extraction rules/prompts were not tuned from held-out errors.
