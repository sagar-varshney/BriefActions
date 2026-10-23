# Internal release check — 2.0.0

Date: **24 October 2026**. Content: invented meetings only.

This is an internal release rehearsal. No new-user participants were available.
The [first-user checklist](usability-check.md) remains an uncompleted research
plan; it must not be reported as a completed study.

## Reproducible checks

Install the development dependencies and Chromium as described in
[Development](development.md), then run:

```sh
pnpm build
pnpm test:browser
```

For just the integrated journey, after building:

```sh
node tests/release-journey.browser.mjs
```

| Area | What the rehearsal checks |
| --- | --- |
| First use | A fresh authenticated fixture account opens Extract & review; the public homepage does not expose private records. |
| Review | Real rules extract three actions; missing owner/date remain Unknown. Corrections and selection are explicit, and a located passage matches the source. |
| Session recovery | The real browser SDK receives a rejected refresh. The workspace closes, sign-in returns to the meeting, and the same account recovers review choices and its unfinished input. |
| Confirmation | Only two selected proposals become tasks. Saving a review alone does not confirm it. |
| Follow-through | A progress update and a deadline correction with a reason appear in the task list and calendar. The original confirmed date and evidence remain intact. |
| Read recovery | A simulated calendar outage offers an explicit retry and preserves the selected date. |
| Export | The confirmed plan downloads successfully. Focused suites additionally check export content and interrupted downloads. |
| Mobile and themes | Review and calendar are checked at 320 pixels and desktop width in Light and Dark. Mobile task selection works by keyboard; automated axe scans supplement visual inspection. |

Auth responses are fixtures, and the server uses a temporary SQLite database. No
production users, transcripts, or live OAuth settings are accessed by this test.
The focused suites also cover conflicts, lost write responses, two-account browser
isolation, imports, annotations, deletion, plan changes, recurring meetings, and
responsive keyboard navigation. CI uses a separate disposable Postgres database
for hosted storage, account isolation, and backup/restore checks.

## Public deployment smoke check

```sh
node scripts/check_deployment.mjs live https://briefactions.onrender.com
```

This probes public routes, health, security headers, and rejection of unsigned or
cross-origin private requests. It creates no records. It does **not** verify a live
signed-in user's OAuth round trip, multi-account workflow, persistence across a
redeploy, or a production backup restore. Those remain separate operator checks
in [Launch checks](launch-checks.md).

## Evidence and remaining validation

Screenshots in the README come from `pnpm screenshots`, using the invented meeting
in the integrated journey. Full suite logs and screenshots are retained as GitHub
Actions artifacts under that run's retention policy. The release tag identifies
the source; the workflow run identifies the exact tested commit.

Before broader product claims, obtain independent first-user observations,
manual assistive-technology testing, and permitted real-transcript annotations.
No claims about those results follow from passing this internal rehearsal.
