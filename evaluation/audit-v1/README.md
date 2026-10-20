# Extraction development audit · 20 October 2026

This is a **targeted development regression set**, with 28 invented conversations
and 23 labeled actions. All cases were available for tuning. The examples and
labels were authored by an AI assistant before running predictions; they have not
been independently human-reviewed. They are not real meeting transcripts or a
new held-out accuracy estimate. The existing reserved test sets were not scored
or used for this stage.

`build_cases.py` directly specifies the task, owner, deadline, and intended quotes.
It only calculates offsets and the manifest, and never imports the extractor.
`manifest.json` freezes the resulting UTF-8 corpus hash. Date contexts include a
leap day, year rollover, vague/numeric dates, and the maximum supported year.

## What the audit changed

- Recognize straight and smart-apostrophe commitment contractions, including
  first-person, named-person and plural commitments. A plural owner stays Unknown.
- Keep periods inside versions, filenames, links, and email addresses together
  with the task and deadline. Separate sentences still retain exact source offsets.
- Distinguish negated commitments from negative words describing agreed work:
  investigating why a worker will not start is still a task.
- Keep unrepresentable date calculations Unknown instead of aborting extraction.
  Optional schedule suggestions also fail safely at the calendar boundary.
- Record both extraction and plan-comparison component hashes for new follow-up
  comparisons, so changes to their shared rules are inspectable.

## Before and after on these development cases

The before report was generated from commit
`5447c57f0f8b6ab49e6602d02b44f20574fe185d` before changing the extraction rules.
Both reports retain the same corpus and evaluator hashes, per-case predictions,
matches, failures, and source-code fingerprints. Do not overwrite the before
report when changing implementation.

| Check | Before | After |
| --- | ---: | ---: |
| Tasks found / labeled tasks | 9 / 23 | 23 / 23 |
| Task precision | 100% | 100% |
| Task recall | 39.1% | 100% |
| Task F1 | 56.3% | 100% |
| Correct owners / matched tasks | 9 / 9 | 23 / 23 |
| Correct dates / matched tasks | 5 / 9 | 23 / 23 |
| Known-owner end-to-end | 38.1% | 100% |
| Known-date end-to-end | 11.1% | 100% |
| Exact valid evidence spans | 100% | 100% |
| Annotated support proxy | 55.6% | 100% |
| Extraction failures | 2 / 28 | 0 / 28 |

These results show that the selected regressions were repaired. They do not
establish general accuracy, independent review, or semantic entailment. The
support proxy uses the existing lexical matching and annotated-span rules.
Single-run latency in the JSON reports excludes classification, scheduling,
HTTP/storage, and human review. No language-model calls or provider comparisons
were made in this audit.

```sh
python evaluate.py --extractor rules --dataset evaluation/audit-v1/dev.jsonl \
  --split dev --output artifacts/audit-dev.json
python scripts/check_benchmark.py artifacts/audit-dev.json \
  --dataset evaluation/audit-v1/dev.jsonl \
  --baseline evaluation/audit-v1/results/after.json
```

CI checks this floor as well as the two existing development sets. Unit tests
also assert exact task text, metadata, and supporting passages for every audit
case, beyond the lexical score. The baseline is not refreshed automatically.

## Remaining limits and review workflow

Extraction still uses a finite English grammar and action vocabulary. A promise
such as “I'll renew the licence” can be missed; the browser regression deliberately
uses it to verify **Add a missed action** with exact evidence and explicit user
selection. Other open areas include abbreviations such as “Jan.”, indirect
commitments, cross-speaker references, ambiguous dates, and complex clauses with
different people or deadlines. A larger independently annotated corpus with
permitted real conversations remains necessary.

The review now offers **What should I check?** in plain language. It explains task
meaning, the person doing the work, meeting-relative dates, missed actions, and
why a suggestion without an attention flag still needs review. An empty result
offers a keyboard-accessible path to add missed work instead of implying that
the conversation has no actions. Automated checks and visual inspection are not
new-user research; use the [human feedback checklist](../../docs/usability-check.md)
before launch.
