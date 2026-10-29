# Expanded extraction regression contracts

`extraction-expanded.json` retains the 74 invented input cases and expected
outcomes specified before the 30 October 2026 exploratory audit. Nine failed on
release `e88e8dd59935fa0926d6c0865ae1045c0e852a91`, covering five issues.

Each case specifies a meeting date, task count and expected task/owner/deadline
fields. Some ambiguity probes intentionally constrain only owner and deadline;
dedicated tests also require retaining the alternatives for review. Evidence
offsets must always reproduce the original passage, and selected cases fix the
number of supporting passages. These expectations are not generated from the
current extractor.

Python and API regression suites exercise every case. Additional tests cover
merge/cancellation history, Unicode marks and symbols, canonical equivalents,
conditional technical/quoted objects, uncertainty in follow-ups, legacy task IDs,
progress and explicit approval before Calendar updates.

This is a synthetic development regression set, not an independently reviewed
corpus, held-out model benchmark or real-meeting accuracy estimate. The existing
reserved corpora and retained model comparison reports are unchanged.
