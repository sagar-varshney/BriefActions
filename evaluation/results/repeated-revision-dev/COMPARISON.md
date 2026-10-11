# Repeated local model comparison on revision-v1 development data

216 actual calls: 3 installed models × 2 unchanged prompts × 3 repeats × 12 synthetic development transcripts.
Transcripts and gold labels were manually authored by Codex, not independently reviewed. No real transcripts were supplied.
This screens behavior on explicit revision/cancellation scenarios; it is not representative meeting accuracy or a held-out model selection result.

Temperature 0 and seed 42 were fixed. Zero observed quality variance means repeatability under those settings, not certainty about generalization.
Latency includes startup/model loading and was measured while local UI/API verification also ran; it is not an isolated throughput benchmark.
API fees were $0; hardware and electricity costs are excluded. Standard deviation is across three report-level metrics, not a confidence interval.

| Model / prompt | F1 mean | F1 SD | Owner matched mean | Date matched mean | Support mean | p50 latency mean ± SD (ms) | Failures per pass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| llama3_2_3b / v1 | 64.7% | 0.0% | 100.0% | 18.2% | 9.1% | 6321.9 ± 987.5 | 1 / 12 |
| llama3_2_3b / v2 | 71.0% | 0.0% | 63.6% | 18.2% | 0.0% | 5918.4 ± 1541.8 | 1 / 12 |
| qwen2_5_0_5b / v1 | 88.0% | 0.0% | 81.8% | 18.2% | 0.0% | 1045.5 ± 195.1 | 1 / 12 |
| qwen2_5_0_5b / v2 | 84.6% | 0.0% | 90.9% | 18.2% | 7.1% | 1356.5 ± 262.2 | 1 / 12 |
| qwen2_5_1_5b / v1 | 62.5% | 0.0% | 100.0% | 10.0% | 5.0% | 3332.7 ± 768.8 | 1 / 12 |
| qwen2_5_1_5b / v2 | 64.0% | 0.0% | 100.0% | 37.5% | 15.4% | 2665.4 ± 504.6 | 1 / 12 |

All combinations failed the invalid exact-date scenario (revision-dev-07) on every pass. Raw output and invalid items are retained.
The rules have zero failures and all quality metrics at 100% on these 12 targeted development cases. The 12 fresh synthetic held-out scenarios also passed;
their manually chosen linguistic patterns relate to development and do not establish real-meeting accuracy.
Rules remain the app default. Do not tune on the new test split after inspecting results; prepare a fresh reviewed snapshot for further validation.

Individual JSON files retain every case, usage, actual model ID, generation options, prompt/data/scoring/runner hashes and failures.
`repeat-summary.json` retains per-case failure counts, metric means, sample standard deviations, ranges, known-run counts and report hashes.
`environment.json` records the inventory/digests and local runtime. Corpus identity is checked by hash, not filename.
