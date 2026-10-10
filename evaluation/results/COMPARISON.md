# Retained extraction comparison

30 synthetic held-out transcripts / 29 gold actions. Annotations were authored by Codex,
not independently reviewed. Related scenarios occur across dev/test. Task matching is
lexical and gold support is a proxy, not semantic entailment. These results do not
establish real-meeting accuracy. Model/prompt combinations have one pass each.

The improved rules were tuned on development cases. Versioned prompt text was unchanged
during these runs. A missing adapter ISO-date constraint was corrected after preliminary
test inspection; all final LLM comparisons were rerun under that same corrected contract.
Superseded reports are archived outside this table. Future validation needs a fresh split.

| Extractor / prompt | Task F1 | Owner accuracy (matched) | Date accuracy (matched) | Gold support proxy | Failed transcripts |
| --- | ---: | ---: | ---: | ---: | ---: |
| [baseline](baseline-test.json) | 76.7% | 87.0% | 65.2% | 45.2% | 0/30 |
| [rules](rules-test.json) | 94.7% | 100.0% | 96.3% | 92.9% | 0/30 |
| [llama3_2_3b-v1-1](local-model-comparison/llama3_2_3b-v1-1-test.json) | 71.6% | 83.3% | 29.2% | 15.8% | 3/30 |
| [llama3_2_3b-v2-1](local-model-comparison/llama3_2_3b-v2-1-test.json) | 84.4% | 66.7% | 22.2% | 14.3% | 1/30 |
| [qwen2_5_0_5b-v1-1](local-model-comparison/qwen2_5_0_5b-v1-1-test.json) | 70.2% | 80.0% | 10.0% | 3.6% | 5/30 |
| [qwen2_5_0_5b-v2-1](local-model-comparison/qwen2_5_0_5b-v2-1-test.json) | 73.7% | 85.7% | 14.3% | 10.7% | 4/30 |
| [qwen2_5_1_5b-v1-1](local-model-comparison/qwen2_5_1_5b-v1-1-test.json) | 75.8% | 96.0% | 48.0% | 27.0% | 1/30 |
| [qwen2_5_1_5b-v2-1](local-model-comparison/qwen2_5_1_5b-v2-1-test.json) | 75.4% | 82.6% | 39.1% | 21.9% | 1/30 |

| Extractor / prompt | p50 latency (ms) | p95 latency (ms) | Total API fees (USD) | Input / output tokens |
| --- | ---: | ---: | ---: | ---: |
| baseline | 0.03 | 0.27 | 0.000000 | N/A |
| rules | 0.04 | 0.19 | 0.000000 | N/A |
| llama3_2_3b-v1-1 | 6126.31 | 18307.78 | 0.000000 | 12925 / 2972 |
| llama3_2_3b-v2-1 | 6226.23 | 9981.79 | 0.000000 | 19555 / 2597 |
| qwen2_5_0_5b-v1-1 | 1290.05 | 2423.64 | 0.000000 | N/A |
| qwen2_5_0_5b-v2-1 | 1329.67 | 2315.19 | 0.000000 | 19323 / 2418 |
| qwen2_5_1_5b-v1-1 | 3211.62 | 6397.58 | 0.000000 | 12693 / 2683 |
| qwen2_5_1_5b-v2-1 | 2824.76 | 4427.39 | 0.000000 | 19323 / 2514 |

Local model API fees exclude hardware/electricity. Unreported usage/cost remains unknown.
LLM latency includes process startup, service loading, generation and validation;
rules timing excludes downstream ML and scheduling. No repeated-run latency claim is made.

The app continues to use the improved rules. These measurements screen specific local
models/prompts; they do not automatically select a winner using held-out performance.
Each JSON report retains predictions, invalid outputs, matches/misses, usage and hashes.
Known-owner/date end-to-end metrics are in the reports and app, alongside conditional
accuracies, so missed tasks cannot be hidden by high accuracy on a small matched subset.
