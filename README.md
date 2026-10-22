# BriefActions

**Turn meeting transcripts into action plans.**

Find the next steps in a conversation, check who owns them and when they’re due,
and keep the original words beside every suggestion. Review and confirm your plan,
then follow the work through your task list and calendar.

**[Try BriefActions →](https://briefactions.onrender.com)** · [User guide](docs/user-guide.md) · [Run locally](#run-locally)

[![CI](https://github.com/sagar-varshney/BriefActions/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sagar-varshney/BriefActions/actions/workflows/ci.yml?query=branch%3Amain)

![Review proposed tasks alongside the original transcript in BriefActions](docs/screenshots/review-light.png)

*Shown with an invented example meeting.* [Dark mode](docs/screenshots/review-dark.png) · [All tasks](docs/screenshots/all-tasks-light.png)

## Get started

Want a preview first? [Try the interactive demo](https://briefactions.onrender.com/#product-demo)
without signing in. Step through an invented transcript, adjust task details,
and build a sample plan. Demo changes stay on that page and clear on reload.

1. **Sign in.** Open [BriefActions](https://briefactions.onrender.com) and continue
   with GitHub. Your account has its own saved meetings, plans, and reviews.
2. **Add a conversation.** Paste a transcript, import a TXT, VTT, or SRT file, or
   try the built-in example. Choose the meeting date to resolve words like “tomorrow.”
3. **Review the suggestions.** Check the supporting passages, correct details,
   add missed actions, and select the tasks to keep. Missing owners and dates stay **Unknown**.
4. **Confirm and follow through.** Track progress, check deadlines, and copy or
   export your reviewed plan.

New accounts start at **Extract & review**. Returning users open **My day**.
Short walkthroughs and a glossary are available under **Help** throughout the tool.
Choose **Show meeting tips** for optional guidance beside your transcript, review,
and confirmed plan. Inline explanations define unfamiliar terms; Research tools
include a worked example before the technical scores.
Requests show the action in progress, explain longer waits, and offer a nearby
retry when loading fails. Saved confirmations appear after the server responds.

The public app runs on free hosting, so the first visit after inactivity can be
slower while the server wakes up. [About Render’s free-hosting behavior](https://render.com/docs/free#spinning-down-on-idle).

## A quick example

For a meeting dated **22 October 2026**:

```text
Maya: I'll send the launch checklist tomorrow.
Jon: I'll review the onboarding flow by Monday.
Action item: Update the FAQ.
```

BriefActions proposes:

| Task | Owner | Deadline |
| --- | --- | --- |
| Send the launch checklist | Maya | 23 October 2026 |
| Review the onboarding flow | Jon | 26 October 2026 |
| Update the FAQ | Unknown | Unknown |

Each suggestion includes its supporting transcript passage. You can correct or
reject it before confirming; extraction can miss or misread commitments.

## Your workspace

| Section | What you can do |
| --- | --- |
| **Extract & review** | Turn a transcript into proposed tasks, inspect evidence, edit details, and confirm a plan. |
| **My day** | Start with a priority shortcut, then scan overdue work, today’s deadlines, upcoming tasks, and unfinished reviews. Review your week below the daily lists. |
| **All tasks** | Search work across meetings and filter by progress, owner, or due date. |
| **Tasks by owner** | See who has open or overdue work and find tasks that still need an owner. |
| **Calendar** | Distinguish meeting dates from task deadlines with labels and icons. Inspect selected-day counts, use the mobile agenda, and find undated tasks separately. |
| **Meeting history** | Find saved conversations, inspect previous decisions, and group recurring meetings into a series. |

### Keep plans up to date

- **Review follow-up conversations.** Compare proposed additions, changes, and
  cancellations against the current plan. Approve a new version while keeping
  the previous plan and its evidence in history.
- **Correct deadlines with context.** Record a reason for a date change. Task
  views, exports, and the calendar use the current deadline while retaining the original.
- **Prepare the next conversation.** Build an editable agenda from a meeting
  series or draft a follow-up message from confirmed tasks and progress.
- **Share a reviewed plan.** Copy it or download Markdown or CSV, including its
  supporting passages.

You can browse tasks and the calendar while an extraction runs. A notice lets you
open the result when it is ready, without taking you away from the page you are
using. Calendar, history, and My day refresh when the extraction finishes.

Light, Dark, and System themes are available on sign-in and workspace screens.
The interface supports keyboard navigation and adapts to desktop and mobile screens.

## Your data and saved work

Each account has a separate workspace. Task owners are names recorded in your
plans; **Tasks by owner** groups work within that workspace.

Original transcripts, proposals, user corrections, confirmed plans, and task
updates are retained so you can trace a decision back to its source. Input drafts
stay in the current browser; server-saved reviews and plans are available when
you sign in on another device. Interrupted operations offer recovery using the
same request, and conflicting edits are flagged before replacing saved work.

Use **Data & account** to export your workspace, delete a transcript, or delete
your account. Downloaded copies and backups are separate from the live workspace.
Read [Privacy & data](https://briefactions.onrender.com/privacy) for more detail.

Current extraction uses rules on the application’s Python backend. The everyday
transcript workflow does not send your transcript to an external language-model API.

## Run locally

For development, use **Node.js 24+**, **pnpm 11.25.0**, and **Python 3.10+**
(CI uses Python 3.13).

```bash
git clone https://github.com/sagar-varshney/BriefActions.git
cd BriefActions
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm dev
```

On Windows, activate the environment with `.venv\Scripts\Activate.ps1` in
PowerShell instead of the `source` command.

Open [http://127.0.0.1:5173](http://127.0.0.1:5173), choose **Get started**, then
**Open local workspace**. Local development needs no account or hosted credentials
and stores history in the ignored `data/history.sqlite3` database.
The `.env.example` file is a hosted deployment template; you do not need to copy it
for local development.

## For developers

The live app runs on **Render**, with **Supabase Auth and Postgres** for hosted
accounts and storage. React and Vite provide the interface, Node serves the API,
and Python handles extraction and history. Local development uses SQLite.

[GitHub Actions](https://github.com/sagar-varshney/BriefActions/actions/workflows/ci.yml)
checks Python and API behavior, desktop/mobile browser flows, automated
accessibility, Postgres account isolation, backup/restore, extraction quality,
and the Docker app under a 512 MiB / 0.1 CPU resource profile.

Optional **Research tools** support labeling examples and inspecting extraction
comparisons. Developer scripts can compare models and prompts in repeated runs.
The bundled evaluation examples are synthetic and AI-authored, with no independent
human review; their scores do not establish accuracy on real meetings.
See the [evaluation methodology](evaluation/README.md) for datasets, results, and limitations.

| Guide | What it covers |
| --- | --- |
| [User guide](docs/user-guide.md) | Everyday workflows, walkthroughs, task tracking, and exports |
| [Development](docs/development.md) | Architecture, settings, API routes, and test commands |
| [Performance](docs/performance.md) | Worker queues, connection reuse, measurements, and limits |
| [Deployment](docs/deployment.md) | Hosting your own instance, authentication, and database setup |
| [First deployment](docs/first-deploy.md) | Setup walkthrough for a new Render and Supabase project |
| [Backups](docs/backups.md) | Encrypted snapshots and recovery; scheduling requires operator setup |
| [Launch checks](docs/launch-checks.md) | Operational and live verification |
| [Evaluation](evaluation/README.md) | Annotation policy, scoring, and model experiments |

A separate legacy FastAPI/RAG backend is preserved in `app/`; its
[reference guide](docs/rag-backend.md) describes that implementation.
