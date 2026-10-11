"""Evidence-grounded, conservative rules. No model or network access required."""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from datetime import date, timedelta

UNKNOWN = "Unknown"


@dataclass
class Evidence:
    text: str
    start: int
    end: int


@dataclass
class ActionItem:
    task: str
    owner: str = UNKNOWN
    deadline: str = UNKNOWN
    priority: str = "Low"
    evidence: list[Evidence] = field(default_factory=list)
    proposal_id: str = ""
    category: str = ""
    confidence: float = 0.0
    cluster: int = 0
    suggested_slot: str = ""


def passages(text: str):
    """Yield exact character spans, keeping speaker context within a line."""
    speaker = None
    for line in re.finditer(r"[^\r\n]+", text):
        speaker = None
        for part in re.finditer(r"[^.!?]+(?:[.!?]+|$)", line.group()):
            raw = part.group()
            trimmed = raw.strip().lstrip("-•* ")
            if not trimmed:
                continue
            start = line.start() + part.start() + raw.index(trimmed)
            prefix = re.match(r"([A-Z][\w-]*(?: [A-Z][\w-]*)?)\s*:\s*", trimmed)
            if prefix and prefix.group(1).lower() not in {"task", "todo", "action item", "owner"}:
                speaker = prefix.group(1)
                body = trimmed[prefix.end():]
            else:
                body = trimmed
            yield body, speaker, Evidence(trimmed, start, start + len(trimmed))


VERBS = r"(?:follow up|send|prepare|create|review|update|finali[sz]e|schedule|fix|test|draft|share|deploy|design|analy[sz]e|contact|confirm|complete|investigate|document|publish|coordinate|add|write|check|book|deliver|submit|reconcile|archive|replace|audit|migrate|run|resolve|collect|verify|reduce|implement|merge|remove|present|validate|export)"
NAMES = r"(?:@[\w-]+|[A-Z][\w-]*(?: [A-Z][\w-]*)?)"
COMMIT = r"(?:will|shall|must|should|needs? to|has to|have to|is going to|is assigned to)"
MONTHS = {name.lower(): i for i, name in enumerate(("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"), 1)}
MONTHS.update({k[:3]: v for k, v in list(MONTHS.items())})
WEEKDAYS = {name.lower(): i for i, name in enumerate(("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"))}


def parse_deadline(body: str, reference_date: date) -> date | None:
    # A date must be in a due-date clause, not background narrative.
    temporal = r"(?:20\d{2}[-/]|today\b|tomorrow\b|(?:(?:this|next) )?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b|end of week\b|in \d+ days?\b|Jan(?:uary)?\b|Feb(?:ruary)?\b|Mar(?:ch)?\b|Apr(?:il)?\b|May\b|Jun(?:e)?\b|Jul(?:y)?\b|Aug(?:ust)?\b|Sep(?:tember)?\b|Oct(?:ober)?\b|Nov(?:ember)?\b|Dec(?:ember)?\b)"
    marker = re.search(rf"\b(?:by|before|due(?: on)?|deadline\s*[:=]?|on|at)\s+({temporal}.*)|\b(today|tomorrow|this Friday|end of week|in \d+ days?)\b", body, re.I)
    if not marker:
        return None
    value = (marker.group(1) or marker.group(2)).strip().rstrip(".!?").lower()
    iso = re.match(r"(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b", value)
    if iso:
        try:
            return date(*map(int, iso.groups()))
        except ValueError:
            return None
    if re.match(r"today\b", value):
        return reference_date
    if re.match(r"tomorrow\b", value):
        return reference_date + timedelta(days=1)
    days = re.match(r"in (\d+) days?\b", value)
    if days:
        return reference_date + timedelta(days=int(days.group(1)))
    weekday = re.match(r"(?:(this|next) )?(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b", value, re.I)
    if weekday:
        target = WEEKDAYS[weekday.group(2).lower()]
        offset = (target - reference_date.weekday()) % 7
        if weekday.group(1) == "next":
            offset = 7 - reference_date.weekday() + target
        return reference_date + timedelta(days=offset)
    if value.startswith("end of week"):
        return reference_date + timedelta(days=(4 - reference_date.weekday()) % 7)
    named = re.match(r"([a-z]+) (\d{1,2})(?:st|nd|rd|th)?(?:,? (20\d{2}))?\b", value)
    if named and named.group(1) in MONTHS:
        try:
            parsed = date(int(named.group(3) or reference_date.year), MONTHS[named.group(1)], int(named.group(2)))
            if not named.group(3) and parsed < reference_date:
                parsed = date(parsed.year + 1, parsed.month, parsed.day)
            return parsed
        except ValueError:
            return None
    # A week/month is an interval; do not invent an exact day.
    return None


def priority(body: str, deadline: date | None, reference_date: date) -> str:
    if re.search(r"\b(?:urgent(?:ly)?|asap|critical|blocker|immediately|high priority)\b", body, re.I) or deadline and (deadline - reference_date).days <= 2:
        return "High"
    if re.search(r"\b(?:soon|important|this week)\b", body, re.I) or deadline and (deadline - reference_date).days <= 7:
        return "Medium"
    return "Low"


def normalize_task(task: str) -> str:
    return " ".join(token for token in re.findall(r"[a-z0-9]+", task.lower()) if token not in {"a", "an", "the"})


def deduplicate(items: list[ActionItem]) -> list[ActionItem]:
    merged: list[ActionItem] = []
    for item in items:
        duplicate = next((old for old in merged if
            normalize_task(old.task) == normalize_task(item.task)
            and (old.owner == item.owner or UNKNOWN in {old.owner, item.owner})
            and (old.deadline == item.deadline or UNKNOWN in {old.deadline, item.deadline})), None)
        if duplicate:
            duplicate.evidence.extend(e for e in item.evidence if e not in duplicate.evidence)
            if duplicate.owner == UNKNOWN:
                duplicate.owner = item.owner
            if duplicate.deadline == UNKNOWN:
                duplicate.deadline = item.deadline
            duplicate.priority = min((duplicate.priority, item.priority), key={"High": 0, "Medium": 1, "Low": 2}.get)
        else:
            merged.append(item)
    for item in merged:
        item.proposal_id = hashlib.sha256(f"{normalize_task(item.task)}|{item.owner}|{item.deadline}".encode()).hexdigest()[:16]
    return merged


def extract_with_changes(text: str, reference_date: date | None = None):
    reference_date = reference_date or date.today()
    items = []
    changes = []
    previous = None
    for body, speaker, evidence in passages(text):
        body = body.strip()
        cancel = re.match(r"^(?:Actually,?\s+)?(?:cancel|drop)\s+(.+?)[.!?]*$",body,re.I)
        revise = re.match(r"^(?:Actually,?\s+)?(?:make|move|reschedule)\s+(.+?)\s+(?:to\s+|by\s+|on\s+)?((?:(?:this|next) )?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|tomorrow|today|next week|20\d{2}-\d{2}-\d{2})[.!?]*$",body,re.I)
        if cancel or revise:
            items = deduplicate(items)
            target = (cancel or revise).group(1).strip(' .!?')
            if re.fullmatch(r"(?:that|it|that task|that deadline)",target,re.I):
                candidates = [p for p in items if previous and p is previous and (not speaker or speaker==p.owner)]
            else:
                target_tokens=set(normalize_task(target).split())-{'task','deadline'}
                candidates=[p for p in items if target_tokens and target_tokens<=set(normalize_task(p.task).split())]
            if len(candidates)==1:
                item=candidates[0]
                before=item.deadline
                support=[{'text':e.text,'start':e.start,'end':e.end} for e in item.evidence]+[{'text':evidence.text,'start':evidence.start,'end':evidence.end}]
                if cancel:
                    items.remove(item)
                    changes.append({'kind':'cancellation','task':item.task,'owner':item.owner,'deadline':before,'evidence':support})
                    previous=None
                else:
                    parsed=parse_deadline('by '+revise.group(2),reference_date)
                    # Invalid exact dates require review; never keep an obsolete deadline.
                    item.deadline=parsed.isoformat() if parsed else UNKNOWN
                    item.priority=priority(body,parsed,reference_date)
                    item.evidence.append(evidence)
                    changes.append({'kind':'deadline_revision','task':item.task,'before':before,'after':item.deadline,'evidence':support})
                    previous=item
            else:
                changes.append({'kind':'unresolved_reference','directive':body,'reason':'No unique, immediate action reference','evidence':[{'text':evidence.text,'start':evidence.start,'end':evidence.end}]})
                previous=None
            continue
        previous=None
        body = re.sub(r"\bI'll\b", "I will", body, flags=re.I)
        # Completed, cancelled, negated and hypothetical work isn't a commitment.
        if re.search(r"\b(?:won't|will not|don't|do not|no longer|already|yesterday|cancelled|canceled|might|maybe|could potentially)\b", body, re.I):
            continue
        if re.match(r"(?:if\b|should we\b|can we\b|we discussed\b|we reviewed\b|we used to\b)", body, re.I):
            continue
        owner = UNKNOWN
        task = None
        explicit = re.match(rf"({NAMES}(?: and {NAMES})?|I|We|They|You|He|She|The team)\s+{COMMIT}\s+(?:urgently\s+)?({VERBS}\b.+)", body)
        if explicit:
            candidate, task = explicit.groups()
            owner = speaker if candidate == "I" and speaker else UNKNOWN if candidate.lower() in {"i", "we", "they", "you", "he", "she", "the team"} else candidate.lstrip("@")
        else:
            request = re.match(rf"(?:({NAMES}),?\s+)?(?:please\s+|(?:could|can) you\s+)({VERBS}\b.+)", body, re.I)
            tagged = re.match(rf"(?:action item|todo|task)\s*:\s*(.+)", body, re.I)
            imperative = re.match(rf"({VERBS}\b.+)", body, re.I)
            if request:
                owner = request.group(1) or UNKNOWN
                task = request.group(2)
            elif tagged:
                task = tagged.group(1)
            elif imperative:
                task = imperative.group(1)
        if not task or len(task.split()) < 2:
            continue
        assigned = re.search(r"\b(?:owner|assigned to)\s*[:=]?\s*(@?[A-Z][\w-]*(?: [A-Z][\w-]*)?)", body)
        if assigned:
            owner = assigned.group(1).lstrip("@")
        deadline = parse_deadline(task, reference_date)
        # Keep vague timing in task text so the user can resolve it in review.
        task = re.sub(r"\s*[;,]\s*(?:owner|assigned to)\b.*$", "", task, flags=re.I)
        task = re.sub(r"\s+\b(?:by|before|due(?: on)?|on)\s+(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|[A-Z][a-z]+ \d{1,2}(?:st|nd|rd|th)?(?:,? 20\d{2})?|(?:(?:this|next) )?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|today|tomorrow|end of week)\b.*$", "", task, flags=re.I)
        task = re.sub(r"\s+(?:today|tomorrow|in \d+ days?)\b.*$", "", task, flags=re.I).strip(" .?!")
        items.append(ActionItem(task=task, owner=owner, deadline=deadline.isoformat() if deadline else UNKNOWN, priority=priority(body, deadline, reference_date), evidence=[evidence]))
        items=deduplicate(items)
        previous=items[-1] if items[-1].evidence[-1]==evidence else next((p for p in items if evidence in p.evidence),None)
    return deduplicate(items), changes


def extract_action_items(text: str, reference_date: date | None = None) -> list[ActionItem]:
    return extract_with_changes(text,reference_date)[0]
