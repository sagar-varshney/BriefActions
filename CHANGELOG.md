# Release notes

## 29 October 2026 — Navigation and control alignment

- Center desktop workspace navigation and align meeting-series fields and actions.
- Give select controls and disclosure chevrons consistent spacing in both themes,
  retaining native keyboard behavior and system indicators in forced-color mode.

## 29 October 2026 — Task details and security checks

- Inspect a confirmed task in a side panel from All tasks, My day, Calendar, and
  Tasks by owner. Keep the originating view's filters, date, and pagination.
- Reuse progress and deadline corrections with their existing recovery behavior,
  inspect original evidence and task-specific history, and explicitly open the
  full meeting when needed. Unsaved deadline edits require a deliberate discard.
- Protect spreadsheet exports from formula-shaped user text while preserving the
  original evidence and history.
- Reject sensitive build files, escaping symlinks, ambiguous JSON content types,
  compressed bodies and oversized requests; strengthen browser security headers.
- Gate application CI on redacted Git-history secret scanning and dependency
  audits, run weekly scans, and pin the hosted Python dependency snapshot.
- Add stored-XSS and security regressions, private vulnerability reporting and a
  [documented security review](docs/security-review.md).
- Clarify how to verify the live Render commit and use the manual deployment
  fallback after CI passes.

## 28 October 2026 — Guided review and top navigation

- Desktop navigation runs across the top, leaving the full workspace width for
  reviewing tasks and their original conversation. Mobile quick navigation and
  the More menu remain available on smaller screens.
- The default **Guided workspace** shows a task list, one task editor, and the
  supporting conversation on wide screens. On mobile, use the task picker and
  **Keep & next** or **Skip & next**. Existing review layouts remain available
  under **Review options**.
- **Review selection** opens a summary of all selected tasks, including those
  outside the current filter. Only explicit confirmation creates the plan;
  missing owners and deadlines can remain **Unknown**.

See the [user guide](docs/user-guide.md) for the workflow and
[PR #2](https://github.com/sagar-varshney/BriefActions/pull/2) for the shipped change.

## 2.0.0 — 24 October 2026

BriefActions is publicly available at [briefactions.onrender.com](https://briefactions.onrender.com).
This is the first tagged release of the current React, Node, and Python application.

### From a conversation to a reviewed plan

- Extract tasks, owners, and dates with exact supporting passages. Missing details
  remain **Unknown**; suggestions need an explicit review and confirmation.
- Correct proposals, add missed actions, and recover unfinished reviews. Saved
  evidence continues to refer to the original conversation after input edits.
- Track progress in My day, All tasks, Tasks by owner, and Calendar. Change a
  deadline with a reason while preserving the original date and supporting words.
- Compare follow-up conversations before applying changes or cancellations. Group
  recurring meetings, prepare agendas, and draft follow-up messages.
- Import TXT, VTT, and SRT transcripts and export reviewed plans or account data.

### A clearer, more resilient workspace

- Public interactive demo, GitHub sign-in, separate account workspaces, and
  first-use guidance. Optional Help includes walkthroughs and plain-language terms.
- Light, Dark, and System themes, mobile agenda, keyboard evidence navigation,
  reduced-motion support, and clearer feedback for waits, retries, and saved edits.
- Workspace and research screens download on demand. The build enforces an
  initial JavaScript budget; the current static entry graph is about **303 kB**
  before compression, excluding CSS, fonts, and the on-demand auth SDK.
- Interrupted writes retain their request identity for explicit recovery. Version
  conflicts require review, and an older save cannot mark newer typing as saved.
- Separate analysis/read worker lanes, persistent worker and database connection
  reuse, private error references, and bounded single-instance capacity.

### Release verification

The [internal release check](docs/release-check.md) records the scope of the
rehearsal, reproducible commands, and limitations. A new end-to-end browser journey
checks rejected session refresh and same-account draft recovery as well as the
review → task → corrected deadline → calendar flow. Screenshots use only an
invented meeting and a disposable account fixture.

CI also checks Python/API behavior, responsive browser flows, automated
accessibility, real Postgres account isolation, encrypted backup/restore,
development extraction quality gates, and a constrained production container.
See [CI runs](https://github.com/sagar-varshney/BriefActions/actions/workflows/ci.yml)
for results for each commit.

### Current limitations

- Extraction uses rules and can miss or misread commitments. Bundled evaluation
  examples are synthetic and AI-authored, without independent human review;
  benchmark results do not establish accuracy on real meetings.
- Internal browser and visual checks do not establish first-user usability or
  complete accessibility conformance. Independent user sessions are still pending.
- Free hosting may sleep after inactivity and has limited concurrent capacity.
  A lighter frontend does not remove the server wake-up delay.
- Browser-only input drafts stay on that browser. Exported files and backups are
  separate copies; backup scheduling and restore drills require operator setup.
- Task owners are names within an account's plan. The app does not send messages,
  invite assignees, or synchronize an external calendar automatically.

No paid hosting or paid model service is required by this release.
