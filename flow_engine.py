"""Classification, grouping and scheduling for reviewed extraction proposals."""
from __future__ import annotations

from dataclasses import asdict
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import silhouette_score
from sklearn.pipeline import Pipeline

from baseline_extractor import TRAINING_EXAMPLES, split_sentences
from extraction import ActionItem, extract_action_items

def build_category_classifier() -> Pipeline:
    """Train the small demo classifier on visible seed examples."""
    texts, labels = zip(*TRAINING_EXAMPLES)
    model = Pipeline(
        (
            ("tfidf", TfidfVectorizer(ngram_range=(1, 2), stop_words="english")),
            ("classifier", LogisticRegression(max_iter=1000, random_state=42)),
        )
    )
    model.fit(texts, labels)
    return model


def classify_items(items: list[ActionItem], model: Pipeline | None = None) -> None:
    if not items:
        return
    model = model or build_category_classifier()
    probabilities = model.predict_proba([item.task for item in items])
    classes = model.named_steps["classifier"].classes_
    for item, row in zip(items, probabilities):
        best = int(np.argmax(row))
        item.category = str(classes[best])
        item.confidence = float(row[best])


def cluster_items(items: list[ActionItem], requested_clusters: int = 3) -> float | None:
    """Assign TF-IDF/K-Means clusters in place and return silhouette score when valid."""
    if not items:
        return None
    if len(items) == 1:
        items[0].cluster = 1
        return None

    cluster_count = max(1, min(requested_clusters, len(items)))
    try:
        matrix = TfidfVectorizer(stop_words="english", ngram_range=(1, 2)).fit_transform(
            [item.task for item in items]
        )
    except ValueError:
        for item in items:
            item.cluster = 1
        return None
    cluster_count = min(cluster_count, len({item.task.lower() for item in items}))
    if cluster_count == 1:
        labels = np.zeros(len(items), dtype=int)
    else:
        labels = KMeans(n_clusters=cluster_count, random_state=42, n_init=10).fit_predict(matrix)
    for item, label in zip(items, labels):
        item.cluster = int(label) + 1
    if 1 < cluster_count < len(items) and len(set(labels)) > 1:
        return float(silhouette_score(matrix, labels, metric="cosine"))
    return None


def schedule_items(items: list[ActionItem], reference_date: date | None = None) -> None:
    """Create deterministic schedule suggestions; this is a heuristic, not an ML prediction."""
    reference_date = reference_date or date.today()
    priority_hour = {"High": 9, "Medium": 11, "Low": 15}
    owner_offsets: dict[str, int] = {}
    for item in sorted(items, key=lambda value: (priority_hour[value.priority], value.deadline)):
        offset = owner_offsets.get(item.owner, 0)
        try:
            day = reference_date + timedelta(days=offset // 3)
            while day.weekday() >= 5:
                day += timedelta(days=1)
        except OverflowError:
            # An optional scheduling suggestion must not discard extracted work.
            item.suggested_slot = 'Unknown'
            owner_offsets[item.owner] = offset + 1
            continue
        hour = min(priority_hour[item.priority] + (offset % 3), 17)
        item.suggested_slot = datetime.combine(day, datetime.min.time()).replace(hour=hour).strftime(
            "%a, %d %b · %I:%M %p"
        )
        owner_offsets[item.owner] = offset + 1


def summarize(text: str, max_sentences: int = 3) -> str:
    """Return an extractive TF-IDF summary without an external language model."""
    sentences = split_sentences(text)
    if len(sentences) <= max_sentences:
        return " ".join(sentences)
    try:
        matrix = TfidfVectorizer(stop_words="english").fit_transform(sentences)
    except ValueError:
        return " ".join(sentences[:max_sentences])
    scores = np.asarray(matrix.mean(axis=1)).ravel()
    chosen = sorted(np.argsort(scores)[-max_sentences:])
    return " ".join(sentences[index] for index in chosen)


def run_pipeline(text: str, requested_clusters: int = 3, reference_date: date | None = None) -> tuple[pd.DataFrame, str, float | None]:
    items = extract_action_items(text, reference_date)
    classify_items(items)
    score = cluster_items(items, requested_clusters)
    schedule_items(items, reference_date)
    records = [asdict(item) for item in items]
    frame = pd.DataFrame(records)
    if not frame.empty:
        frame["confidence"] = frame["confidence"].map(lambda value: round(value * 100, 1))
        frame = frame.rename(columns={"confidence": "confidence_%"})
    return frame, summarize(text), score


def training_data_frame() -> pd.DataFrame:
    return pd.DataFrame(TRAINING_EXAMPLES, columns=("Example text", "Label"))
