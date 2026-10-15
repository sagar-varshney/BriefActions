# First-user feedback checklist

This is a plan for human sessions, not a report of completed research. Automated
browser tests and the agent's visual inspection do not replace new-user feedback.

Invite a few people who have not used the app. Use the built-in synthetic example
or an invented transcript; no private meeting content is necessary. Give each
person five to ten minutes and let them work without guidance unless blocked.
Do not record names, accounts, or transcript content in feedback notes.

Before starting, ask whether they understand the navigation labels. Let them open
**Help** if they choose; observe whether they can skip and reopen the walkthrough.
Do not explain ML terms in advance.

1. **Create a review.** Ask them to load the example, analyze it, and explain what
   they think has been saved. Observe whether the review is easy to find.
2. **Check a task.** Ask them to find the original passage, correct an owner, and
   select two tasks. Observe whether they can return from the source to the task.
3. **Edit the meeting.** Ask them to open the input editor, make a temporary change,
   close it, and reload. Observe whether they understand that edits survive while
   task evidence still refers to the original conversation. Discard the input draft.
4. **Confirm and follow through.** Ask them to confirm their selected tasks, mark
   one In progress, and find its activity entry. Ask what they think happened to
   the other proposed tasks.
5. **Return later.** Ask them to find the meeting in Meeting history, reopen it,
   and use browser Back/Forward. Repeat passage inspection on a narrow screen.

For someone interested in quality tools, also ask them to explain what an example
dataset and expected task are, select a passage using the keyboard, and explain
one comparison row. Observe whether they distinguish extra suggestions from proven
unsupported outputs and can find the detailed score explanations.

For each task, record completed without help / completed with help / blocked,
approximate time, unfamiliar words, misplaced clicks, and the participant's own
explanation of the result. Record observations separately from interpretations.

| Task | Outcome | Time | Observation / quoted feedback | Proposed change |
| --- | --- | --- | --- | --- |
| Create a review | Not tested | — | — | — |
| Check a task | Not tested | — | — | — |
| Edit the meeting | Not tested | — | — | — |
| Confirm and follow through | Not tested | — | — | — |
| Return later | Not tested | — | — | — |

Prioritize changes that prevent a task, lose work, confuse saved evidence with
edited input, or recur across sessions. Rerun the affected flow after a change.
