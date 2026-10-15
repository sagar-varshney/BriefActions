"""Core NLP and ML pipeline for the BriefActions demo."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta
from typing import Iterable



ACTION_PATTERNS = (
    r"\b(?:will|shall|need(?:s)? to|should|must|has to|have to|assigned to|action item)\b",
    r"\b(?:follow up|send|prepare|create|review|update|finalize|schedule|fix|test|draft|share|deploy|design|analyse|analyze|contact|confirm|complete|investigate|document|publish|coordinate)\b",
)
URGENCY_TERMS = {
    "high": ("urgent", "asap", "critical", "blocker", "today", "immediately", "high priority"),
    "medium": ("tomorrow", "this week", "soon", "important"),
}
MONTHS = {
    month.lower(): index
    for index, month in enumerate(
        (
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December",
        ),
        start=1,
    )
}
MONTHS.update({name[:3]: number for name, number in list(MONTHS.items())})


TRAINING_EXAMPLES = (
    ("fix the login API bug and deploy the backend service", "Engineering"),
    ("write unit tests and review the pull request", "Engineering"),
    ("investigate database latency and update the endpoint", "Engineering"),
    ("define the roadmap and prioritize customer features", "Product"),
    ("write acceptance criteria and review user feedback", "Product"),
    ("prepare requirements for the onboarding flow", "Product"),
    ("launch the email campaign and publish social posts", "Marketing"),
    ("draft the product announcement and measure conversion", "Marketing"),
    ("prepare campaign copy and contact press partners", "Marketing"),
    ("create dashboard mockups and update the design system", "Design"),
    ("review the prototype and run usability testing", "Design"),
    ("design new icons and share the figma screens", "Design"),
    ("schedule the vendor meeting and prepare the budget", "Operations"),
    ("send the invoice and coordinate the team calendar", "Operations"),
    ("document the process and confirm legal approval", "Operations"),
)


@dataclass
class ActionItem:
    task: str
    owner: str
    deadline: str
    priority: str
    category: str = ""
    confidence: float = 0.0
    cluster: int = 0
    suggested_slot: str = ""


def split_sentences(text: str) -> list[str]:
    """Split transcript text into usable sentence-like units."""
    normalized = re.sub(r"\r\n?", "\n", text.strip())
    chunks = re.split(r"(?<=[.!?])\s+|\n+", normalized)
    return [re.sub(r"^[\s\-•*]+", "", chunk).strip() for chunk in chunks if chunk.strip()]


def _clean_task(sentence: str) -> str:
    task = re.sub(r"^(?:action item|todo|task)\s*[:\-]\s*", "", sentence, flags=re.I)
    task = re.sub(r"^(?:okay|great|so|then|also|please|we agreed that)\s*[,;:]?\s*", "", task, flags=re.I)
    return task.strip(" .")


def _extract_owner(sentence: str) -> str:
    speaker = re.match(r"^([A-Z][a-z]+)\s*:\s*(?:I|we)\b", sentence, flags=re.I)
    if speaker:
        return speaker.group(1).title()
    patterns = (
        r"@([A-Za-z][\w-]+)",
        r"\b([A-Z][a-z]+)\s+(?:will|shall|should|must|needs? to|has to|is assigned to)\b",
        r"\b(?:owner|assigned to)\s*[:\-]?\s*([A-Z][a-z]+)\b",
    )
    for pattern in patterns:
        match = re.search(pattern, sentence)
        if match:
            candidate = match.group(1)
            if candidate.lower() not in {"i", "we", "you", "they", "he", "she"}:
                return candidate
    return "Unassigned"


def _parse_deadline(sentence: str, reference_date: date) -> date | None:
    lowered = sentence.lower()
    if "today" in lowered:
        return reference_date
    if "tomorrow" in lowered:
        return reference_date + timedelta(days=1)
    if "end of week" in lowered or "this friday" in lowered:
        return reference_date + timedelta(days=(4 - reference_date.weekday()) % 7)
    if "next week" in lowered:
        return reference_date + timedelta(days=7)

    iso = re.search(r"\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b", sentence)
    if iso:
        try:
            return date(*(int(part) for part in iso.groups()))
        except ValueError:
            return None

    named = re.search(
        r"\b(?:by|before|on)?\s*(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?",
        sentence,
        flags=re.I,
    )
    if named:
        month = MONTHS[named.group(1).lower()]
        year = int(named.group(3) or reference_date.year)
        try:
            parsed = date(year, month, int(named.group(2)))
            if not named.group(3) and parsed < reference_date:
                parsed = parsed.replace(year=year + 1)
            return parsed
        except ValueError:
            return None
    return None


def _priority(sentence: str, deadline: date | None, reference_date: date) -> str:
    lowered = sentence.lower()
    if any(term in lowered for term in URGENCY_TERMS["high"]):
        return "High"
    if deadline and (deadline - reference_date).days <= 2:
        return "High"
    if any(term in lowered for term in URGENCY_TERMS["medium"]):
        return "Medium"
    if deadline and (deadline - reference_date).days <= 7:
        return "Medium"
    return "Low"


def extract_action_items(text: str, reference_date: date | None = None) -> list[ActionItem]:
    """Extract likely action sentences with simple, inspectable rules."""
    reference_date = reference_date or date.today()
    items: list[ActionItem] = []
    seen: set[str] = set()
    for sentence in split_sentences(text):
        if not any(re.search(pattern, sentence, flags=re.I) for pattern in ACTION_PATTERNS):
            continue
        task = _clean_task(sentence)
        key = task.lower()
        if len(task.split()) < 3 or key in seen:
            continue
        seen.add(key)
        deadline = _parse_deadline(sentence, reference_date)
        items.append(
            ActionItem(
                task=task,
                owner=_extract_owner(sentence),
                deadline=deadline.isoformat() if deadline else "Not specified",
                priority=_priority(sentence, deadline, reference_date),
            )
        )
    return items

