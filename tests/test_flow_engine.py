from datetime import date

from flow_engine import extract_action_items, run_pipeline, summarize


TRANSCRIPT = """We discussed customer retention and the beta release.
Asha will urgently fix the payment API by 2026-09-18.
Ravi needs to draft the launch email next week.
The weather was pleasant."""


def test_extracts_action_items_and_metadata():
    items = extract_action_items(TRANSCRIPT, date(2026, 9, 15))
    assert len(items) == 2
    assert items[0].owner == "Asha"
    assert items[0].deadline == "2026-09-18"
    assert items[0].priority == "High"


def test_pipeline_adds_ml_and_schedule_fields():
    frame, summary, score = run_pipeline(TRANSCRIPT, 2, date(2026, 9, 15))
    assert len(frame) == 2
    assert frame["category"].notna().all()
    assert frame["cluster"].between(1, 2).all()
    assert frame["suggested_slot"].str.len().gt(0).all()
    assert isinstance(summary, str)
    assert score is None  # silhouette is undefined when samples == clusters


def test_short_summary_is_preserved():
    assert summarize("First point. Second point.") == "First point. Second point."
