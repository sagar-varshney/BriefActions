These preliminary reports are superseded and excluded from the current comparison.
The old adapter omitted the ISO date constraint from the schema supplied to the
model despite the evaluator requiring YYYY-MM-DD. It also lost raw outputs for
quote-grounding failures. The comparison was stopped when this was discovered.
The old adapter/evaluator and completed reports are retained to trace the mistake.
No conclusions should be drawn from these scores. The corrected adapter restores
the specified contract, preserves failed outputs, and uses the same settings for
all models. All final comparisons were rerun; the corpus and versioned prompts
were unchanged. This fixes the experimental contract, not model semantic behavior.
