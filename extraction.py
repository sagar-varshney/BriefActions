"""Evidence-grounded, conservative rules. No model or network access required."""
from __future__ import annotations

import hashlib
import re
import unicodedata
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
        # Sentence punctuation must finish a token. Internal periods in versions,
        # filenames, email addresses and URLs belong to the supporting passage.
        for part in re.finditer(r".+?(?:[.!?]+(?=\s|$)|$)", line.group()):
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
NON_COMMITMENT = re.compile(r"\b(?:won['’]t|will not|don['’]t|do not|no longer|already|yesterday|cancelled|canceled|might|maybe|could potentially)\b", re.I)
DISCUSSION = re.compile(r"^(?:if\b|should we\b|can we\b|we discussed\b|we reviewed\b|we used to\b)", re.I)
MONTHS = {name.lower(): i for i, name in enumerate(("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"), 1)}
MONTHS.update({k[:3]: v for k, v in list(MONTHS.items())})
WEEKDAYS = {name.lower(): i for i, name in enumerate(("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"))}
CANCEL = re.compile(r"^(?:Actually,?\s+)?(?:cancel|drop)\s+(.+?)[.!?]*$", re.I)
REVISION_DATE = r"(?:(?:(?:this|next) )?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|tomorrow|today|next week|20\d{2}-\d{2}-\d{2})"
DATE_ALTERNATIVE_JOIN = r"(?:\s+or(?:\s+(?:by|on))?\s+|\s*/\s*)"
REVISE = re.compile(
    r"^(?:Actually,?\s+)?(?:make|move|reschedule)\s+(.+?)\s+(?:to\s+|by\s+|on\s+)?"
    rf"({REVISION_DATE}(?:{DATE_ALTERNATIVE_JOIN}{REVISION_DATE})*)"
    r"(?:\s+instead)?[.!?]*$", re.I)
DATE_VALUE = re.compile(
    r"\b(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|"
    r"(?:(?:this|next) )?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|"
    r"today|tomorrow|end of week|next week|in \d+ days?|"
    rf"(?:{'|'.join(sorted(MONTHS, key=len, reverse=True))}) \d{{1,2}}(?:st|nd|rd|th)?(?:,? 20\d{{2}})?)\b", re.I)
QUOTED_TEXT = re.compile(r'''(?<!\w)(?:"[^"\r\n]*"|“[^”\r\n]*”|'[^'\r\n]*'|‘[^’\r\n]*’)''')
CONDITION = re.compile(r"\b(?:if|unless|provided that|as long as|only when)\s+", re.I)
CONDITION_OBJECT = re.compile(r"(?:statements?|clauses?|expressions?|conditions?|branches?|blocks?|functions?|keywords?)\b", re.I)


def non_commitment(body: str) -> bool:
    action = re.search(rf"\b{VERBS}\b", body, re.I)
    # Only inspect the lead-in to the action, not the thing being acted on.
    return bool(NON_COMMITMENT.search(body[:action.start()] if action else body))


def conditional_commitment(body: str) -> bool:
    # Quoted conditions and technical objects describe work, rather than making
    # its completion conditional. An embedded question directly after the action
    # ("investigate if ...") is also part of the committed task.
    visible = QUOTED_TEXT.sub(lambda match: ' ' * len(match.group()), body)
    action = re.search(rf"\b{VERBS}\b", visible, re.I)
    if not action:
        return False
    for marker in CONDITION.finditer(visible):
        if CONDITION_OBJECT.match(visible, marker.end()):
            continue
        if marker.start() <= action.end():
            if re.fullmatch(r"\s*(?:(?:task|todo|action item)\s*:\s*)?", visible[:marker.start()], re.I):
                return True
            continue
        object_words = set(re.findall(r"\w+", visible[action.end():marker.start()].casefold()))
        if object_words - {'a', 'an', 'the', 'my', 'our', 'your', 'their'}:
            return True
    return False


def add_days(reference_date: date, days: int) -> date | None:
    try:
        return reference_date + timedelta(days=days)
    except (OverflowError, ValueError):
        return None


def deadline_marker(body: str):
    # A date must be in a due-date clause, not background narrative.
    temporal = r"(?:20\d{2}[-/]|today\b|tomorrow\b|(?:(?:this|next) )?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b|end of week\b|in \d+ days?\b|Jan(?:uary)?\b|Feb(?:ruary)?\b|Mar(?:ch)?\b|Apr(?:il)?\b|May\b|Jun(?:e)?\b|Jul(?:y)?\b|Aug(?:ust)?\b|Sep(?:tember)?\b|Oct(?:ober)?\b|Nov(?:ember)?\b|Dec(?:ember)?\b)"
    return re.search(rf"\b(?:by|before|due(?: on)?|deadline\s*[:=]?|on|at)\s+({temporal}.*)|\b(today|tomorrow|this Friday|end of week|in \d+ days?)\b", body, re.I)


def has_ambiguous_deadline(body: str) -> bool:
    marker = deadline_marker(body)
    if not marker:
        return False
    value = body[marker.start(1 if marker.group(1) else 2):]
    dates = list(DATE_VALUE.finditer(value))
    return any(re.fullmatch(DATE_ALTERNATIVE_JOIN, value[left.end():right.start()], re.I)
               for left, right in zip(dates, dates[1:]))


def parse_deadline(body: str, reference_date: date) -> date | None:
    marker = deadline_marker(body)
    if not marker:
        return None
    if has_ambiguous_deadline(body):
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
        return add_days(reference_date, 1)
    days = re.match(r"in (\d+) days?\b", value)
    if days:
        try:
            return add_days(reference_date, int(days.group(1)))
        except ValueError:
            return None
    weekday = re.match(r"(?:(this|next) )?(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b", value, re.I)
    if weekday:
        target = WEEKDAYS[weekday.group(2).lower()]
        offset = (target - reference_date.weekday()) % 7
        if weekday.group(1) == "next":
            offset = 7 - reference_date.weekday() + target
        return add_days(reference_date, offset)
    if value.startswith("end of week"):
        return add_days(reference_date, (4 - reference_date.weekday()) % 7)
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
    tokens, word = [], []
    # Include combining marks and meaningful symbols as well as Unicode letters
    # and numbers. Punctuation still separates ordinary ASCII words/filenames.
    for char in unicodedata.normalize('NFC', task).casefold() + ' ':
        kind = unicodedata.category(char)[0]
        if kind in {'L', 'N', 'M'}:
            word.append(char)
            continue
        if word:
            tokens.append(''.join(word))
            word = []
        if kind == 'S':
            tokens.append(char)
    return ' '.join(token for token in tokens if token not in {'a', 'an', 'the'})


def same_speaker(speaker: str | None, owner: str) -> bool:
    return bool(speaker and owner.casefold() != UNKNOWN.casefold() and speaker.casefold() == owner.casefold())


def task_reference_matches(target: str, task: str, owner: str, speaker: str | None) -> bool:
    personal = re.match(r"my\s+", target, re.I)
    if personal:
        # A possessive identifies the speaker's work, never another owner's task.
        if not same_speaker(speaker, owner):
            return False
        target = target[personal.end():]
    tokens = set(normalize_task(target).split()) - {'task', 'deadline'}
    return bool(tokens and tokens <= set(normalize_task(task).split()))


def deduplicate(items: list[ActionItem]) -> list[ActionItem]:
    merged: list[ActionItem] = []
    for item in items:
        duplicate = next((old for old in merged if
            normalize_task(old.task) == normalize_task(item.task)
            and (same_speaker(old.owner, item.owner) or UNKNOWN in {old.owner, item.owner})
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


def strip_task_timing(task: str) -> str:
    task = re.sub(r"\s+\b(?:by|before|due(?: on)?|on)\s+(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|[A-Z][a-z]+ \d{1,2}(?:st|nd|rd|th)?(?:,? 20\d{2})?|(?:(?:this|next) )?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|today|tomorrow|end of week)\b.*$", "", task, flags=re.I)
    return re.sub(r"\s+(?:today|tomorrow|in \d+ days?)\b.*$", "", task, flags=re.I).strip(" .?!")


def extract_with_changes(text: str, reference_date: date | None = None):
    reference_date = reference_date or date.today()
    items = []
    changes = []
    previous = None
    for body, speaker, evidence in passages(text):
        body = body.strip()
        if conditional_commitment(body):
            previous = None
            continue
        cancel = CANCEL.match(body)
        revise = REVISE.match(body)
        if cancel or revise:
            last_support = previous.evidence[-1] if previous else None
            items = deduplicate(items)
            # A revision can make two actions merge. Keep the immediate reference
            # attached to the surviving action through its exact source span.
            previous = next((p for p in items if last_support and last_support in p.evidence), None)
            target = (cancel or revise).group(1).strip(' .!?')
            if re.fullmatch(r"(?:that|it|that task|that deadline)",target,re.I):
                candidates = [p for p in items if previous and p is previous and (not speaker or same_speaker(speaker,p.owner))]
            else:
                candidates=[p for p in items if task_reference_matches(target,p.task,p.owner,speaker)]
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
        # Normalize commitment contractions for matching only; evidence always
        # retains the original Unicode text and offsets.
        pronouns = {'i':'I', 'we':'We', 'they':'They', 'you':'You', 'he':'He', 'she':'She'}
        body = re.sub(rf"\b({NAMES}|I|We|They|You|He|She)['’]ll\b", lambda m: pronouns.get(m[1].lower(),m[1])+' will', body, flags=re.I)
        # These words can also describe the *object* of a real commitment (for
        # example, investigating why a worker won't start). Scope exclusions to
        # the beginning; the commitment/request grammar rejects negated verbs.
        if non_commitment(body):
            continue
        if DISCUSSION.match(body):
            continue
        owner = UNKNOWN
        task = None
        explicit = re.match(rf"({NAMES}(?: and {NAMES})?|I|We|They|You|He|She|The team)\s+(?i:{COMMIT})\s+(?i:urgently\s+)?((?i:{VERBS})\b.+)", body)
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
                if non_commitment(task) or DISCUSSION.match(task):
                    continue
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
        task = task.strip(' .?!') if has_ambiguous_deadline(task) else strip_task_timing(task)
        items.append(ActionItem(task=task, owner=owner, deadline=deadline.isoformat() if deadline else UNKNOWN, priority=priority(body, deadline, reference_date), evidence=[evidence]))
        items=deduplicate(items)
        previous=items[-1] if items[-1].evidence[-1]==evidence else next((p for p in items if evidence in p.evidence),None)
    return deduplicate(items), changes


def extract_action_items(text: str, reference_date: date | None = None) -> list[ActionItem]:
    return extract_with_changes(text,reference_date)[0]
