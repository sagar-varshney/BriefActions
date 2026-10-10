"""Render the current held-out comparison without mixing different corpora."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def percentage(value):
    return 'N/A' if value is None else f'{value*100:.1f}%'


def main():
    reports = []
    for path in (ROOT/'results').rglob('*.json'):
        report = json.loads(path.read_text())
        if report.get('dataset') == 'test.jsonl':
            reports.append((path,report))
    reports.sort(key=lambda pair:(pair[1]['extractor'] == 'llm',pair[1]['label']))
    if len({report['dataset_sha256'] for _,report in reports}) > 1:
        raise ValueError('Cannot compare different test corpus fingerprints')
    lines = ['# Retained extraction comparison','',
        '30 synthetic held-out transcripts / 29 gold actions. Annotations were authored by Codex,',
        'not independently reviewed. Related scenarios occur across dev/test. Task matching is',
        'lexical and gold support is a proxy, not semantic entailment. These results do not',
        'establish real-meeting accuracy. Model/prompt combinations have one pass each.','',
        'The improved rules were tuned on development cases. Versioned prompt text was unchanged',
        'during these runs. A missing adapter ISO-date constraint was corrected after preliminary',
        'test inspection; all final LLM comparisons were rerun under that same corrected contract.',
        'Superseded reports are archived outside this table. Future validation needs a fresh split.','',
        '| Extractor / prompt | Task F1 | Owner accuracy (matched) | Date accuracy (matched) | Gold support proxy | Failed transcripts |',
        '| --- | ---: | ---: | ---: | ---: | ---: |']
    for path,report in reports:
        m = report['metrics']
        label = f"[{report['label']}]({path.relative_to(ROOT/'results')})"
        lines.append(f"| {label} | {percentage(m['task_f1'])} | {percentage(m['owner_accuracy_on_matched'])} | {percentage(m['deadline_accuracy_on_matched'])} | {percentage(m['gold_support_proxy'])} | {report['counts']['failures']}/30 |")
    lines += ['', '| Extractor / prompt | p50 latency (ms) | p95 latency (ms) | Total API fees (USD) | Input / output tokens |',
              '| --- | ---: | ---: | ---: | ---: |']
    for _,report in reports:
        m = report['metrics']
        usage = [run.get('usage',{}) for run in report['runs']]
        totals = 'N/A'
        if usage and all(type(u.get('input_tokens')) is int and type(u.get('output_tokens')) is int for u in usage):
            totals = f"{sum(u['input_tokens'] for u in usage)} / {sum(u['output_tokens'] for u in usage)}"
        fee = 'unknown' if m['cost_usd'] is None else f"{m['cost_usd']:.6f}"
        lines.append(f"| {report['label']} | {m['latency_p50_ms']:.2f} | {m['latency_p95_ms']:.2f} | {fee} | {totals} |")
    lines += ['', 'Local model API fees exclude hardware/electricity. Unreported usage/cost remains unknown.',
              'LLM latency includes process startup, service loading, generation and validation;',
              'rules timing excludes downstream ML and scheduling. No repeated-run latency claim is made.',
              '', 'The app continues to use the improved rules. These measurements screen specific local',
              'models/prompts; they do not automatically select a winner using held-out performance.',
              'Each JSON report retains predictions, invalid outputs, matches/misses, usage and hashes.',
              'Known-owner/date end-to-end metrics are in the reports and app, alongside conditional',
              'accuracies, so missed tasks cannot be hidden by high accuracy on a small matched subset.','']
    (ROOT/'results'/'COMPARISON.md').write_text('\n'.join(lines))
    print(f'Rendered {len(reports)} comparable held-out reports')


if __name__ == '__main__':
    main()
