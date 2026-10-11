"""Fail CI when development extraction quality falls below the retained report."""
import argparse
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
QUALITY_METRICS = (
    'task_precision', 'task_recall', 'task_f1',
    'owner_accuracy_on_matched', 'deadline_accuracy_on_matched',
    'known_owner_end_to_end', 'known_deadline_end_to_end',
    'evidence_validity', 'gold_support_proxy',
)


def regression_errors(current, baseline, dataset_sha256):
    """Check comparable inputs, complete cases, failures, and quality floors."""
    errors = []
    for name, report in (('Current', current), ('Baseline', baseline)):
        if report.get('dataset') != 'dev.jsonl' or report.get('splits') != ['dev'] or report.get('extractor') != 'rules':
            errors.append(f'{name} report must use rules on the development split.')
        if report.get('dataset_sha256') != dataset_sha256:
            errors.append(f'{name} corpus fingerprint differs. Review annotations and refresh the development baseline explicitly.')
    if not baseline.get('evaluator_sha256') or current.get('evaluator_sha256') != baseline['evaluator_sha256']:
        errors.append('Scoring implementation changed. Review scoring changes and refresh the development baseline explicitly.')
    expected_ids = [run.get('id') for run in baseline.get('runs', [])]
    actual_ids = [run.get('id') for run in current.get('runs', [])]
    if not expected_ids or actual_ids != expected_ids:
        errors.append('Current report must contain every development case, in the baseline order.')
    if current.get('counts', {}).get('gold') != baseline.get('counts', {}).get('gold'):
        errors.append('Gold item count differs from the development baseline.')
    if current.get('counts', {}).get('failures') != 0 or current.get('metrics', {}).get('failure_rate') != 0:
        errors.append('Development extraction must finish with zero failures.')
    for metric in QUALITY_METRICS:
        actual = current.get('metrics', {}).get(metric)
        floor = baseline.get('metrics', {}).get(metric)
        if any(type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1 for value in (actual, floor)):
            errors.append(f'{metric}: missing or invalid quality metric.')
        elif actual + 1e-12 < floor:
            errors.append(f'{metric}: {actual:.6f} fell below the retained floor {floor:.6f}.')
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('report', type=Path, help='Fresh evaluate.py rules/dev report')
    parser.add_argument('--baseline',type=Path,default=ROOT/'evaluation'/'results'/'rules-dev.json')
    parser.add_argument('--dataset',type=Path,default=ROOT/'evaluation'/'dev.jsonl')
    args = parser.parse_args()
    try:
        current = json.loads(args.report.read_text())
        baseline = json.loads(args.baseline.read_text())
        fingerprint = hashlib.sha256(args.dataset.read_bytes()).hexdigest()
        errors = regression_errors(current, baseline, fingerprint)
    except (OSError, ValueError, TypeError, AttributeError) as error:
        print(f'Benchmark check could not read valid reports: {error}')
        return 1
    if errors:
        print('Development benchmark check failed:')
        for error in errors:
            print(f'  - {error}')
        return 1
    print(f'Development benchmark passed: {len(current["runs"])} cases, zero failures, all {len(QUALITY_METRICS)} quality metrics meet the retained floors.')
    print('Latency and cost are recorded but are not used as quality gates. No held-out or model experiments were rerun.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
