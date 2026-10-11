"""Exercise the CI quality gate with regressions, incomplete runs, and drift."""
from copy import deepcopy
import json
from pathlib import Path
import unittest

from scripts.check_benchmark import QUALITY_METRICS, regression_errors

ROOT = Path(__file__).resolve().parents[1]


class BenchmarkGateTests(unittest.TestCase):
    def setUp(self):
        self.baseline = json.loads((ROOT/'evaluation'/'results'/'rules-dev.json').read_text())
        self.current = deepcopy(self.baseline)
        self.fingerprint = self.baseline['dataset_sha256']

    def errors(self):
        return regression_errors(self.current, self.baseline, self.fingerprint)

    def test_equal_or_improved_quality_passes_with_different_latency(self):
        self.current['metrics']['latency_p95_ms'] = 99999
        self.current['metrics']['cost_usd'] = None
        self.current['metrics']['gold_support_proxy'] = 1.0
        self.assertEqual(self.errors(), [])

    def test_each_quality_regression_fails(self):
        for metric in QUALITY_METRICS:
            with self.subTest(metric=metric):
                self.current = deepcopy(self.baseline)
                self.current['metrics'][metric] -= .01
                self.assertTrue(any(metric in error for error in self.errors()))

    def test_failed_or_missing_cases_cannot_pass(self):
        self.current['counts']['failures'] = 1
        self.current['runs'].pop()
        errors = self.errors()
        self.assertTrue(any('zero failures' in error for error in errors))
        self.assertTrue(any('every development case' in error for error in errors))

    def test_changed_corpus_scorer_or_split_requires_review(self):
        for key, value in [('dataset_sha256','different'),('evaluator_sha256','different'),('splits',['test']),('extractor','llm')]:
            with self.subTest(key=key):
                self.current = deepcopy(self.baseline)
                self.current[key] = value
                self.assertTrue(self.errors())
        self.assertTrue(regression_errors(self.current,self.baseline,'changed dataset'))

    def test_missing_nan_or_boolean_metric_cannot_pass(self):
        for value in (None, float('nan'), True):
            with self.subTest(value=value):
                self.current = deepcopy(self.baseline)
                self.current['metrics']['task_f1'] = value
                self.assertTrue(any('task_f1' in error for error in self.errors()))
