# Using BriefActions

The public homepage explains the workflow with a sample conversation. Choose
**Get started** or **Sign in**, then continue with GitHub (or an email link when
enabled). After sign-in, a workspace with no saved meetings opens **Extract & review**;
a returning workspace opens **My day**. This uses your account’s saved meetings,
so it works on another browser or device too. A saved meeting
or task link returns to that item after sign-in. Local development instead shows
**Open local workspace**, with no account required. Choose **Light**, **Dark**, or
**System** from **Theme** on the sign-in page; the workspace remembers that choice.
The public homepage always uses its own mix of light and dark sections.

Navigation follows this order: **Extract & review → My day → All tasks → Tasks by owner → Calendar → Meeting history**.
Start in **Extract & review**: add a transcript, check proposed actions, then confirm
your plan. Its **Start here** label, three-step progress bar, sample, and optional
walkthrough help you get started. Use **My day** to choose your next step once work
is saved. **Data & account** sits beside the theme and account controls.
The optional **Research tools** menu stays collapsed until you open it; you do not
need a machine-learning background to turn a meeting into tasks. Open **Help** anywhere
in the workspace for a short walkthrough and glossary. You can close or skip it
without changing your work, and open it again later.

## Start your day

**My day** brings together overdue work, deadlines today, the next seven days, and
saved meetings awaiting confirmation. It includes tasks for every named owner in
your private workspace; owner names are not linked to sign-in accounts.
Completed tasks are excluded. Dates use your device's calendar day.

Each section previews up to four items and shows its complete count. **View all**
opens the corresponding task filter or meetings **Awaiting review**. **Open task &
evidence** goes to the exact confirmed task and its supporting conversation;
**Continue review** resumes a saved task or follow-up review.

**Refresh My day**, returning from another screen, or refocusing the browser checks
for saved changes. The date updates when a long-lived tab crosses midnight.
Tasks without deadlines remain **Unknown** in Calendar's **Unscheduled tasks**;
later deadlines remain available in **All tasks** and **Calendar**.

**Add a conversation** opens the transcript workflow and preserves existing draft
recovery. If an interrupted analysis is saved, choose **Recover saved analysis**
before starting new work. **My day** does not create or confirm tasks automatically.

### Review your week

Choose **Open weekly review** inside **My day**. **Completed recently** shows tasks
still marked Done whose completion was recorded during the last seven calendar
dates, including today, in your device's time zone. A task carried into a follow-up
plan keeps its original completion date; copying a plan does not count it again.
Reopened tasks and earlier plan versions are excluded.

Select **Overdue now**, **Due soon**, or **Unfinished reviews** to inspect work that
needs attention. Due soon includes today through seven days ahead, using current
corrected deadlines. Unfinished reviews includes all saved reviews awaiting
confirmation, regardless of meeting date. Each list has pagination and links to
the exact task or review. Undated open tasks remain available in Calendar.

**Copy weekly summary** copies counts and their date/time-zone labels, rather than
only the visible page of tasks. If clipboard access is blocked, select and copy
the text provided. **Refresh weekly review** reloads saved changes; the view also
refreshes when the browser regains focus or its date/time zone changes. This is a
current workspace snapshot, not a historical report or scheduled email.

## Turn a conversation into tasks

For a recurring conversation, you can first open **Meeting history → Meeting
series** and choose **Add next conversation**. The transcript and date still need
your review before analysis. The series is assigned when the analysis is saved;
opening the editor does not create a meeting. Existing unfinished transcript text
is preserved, so check any restored draft before analyzing it.

1. Paste a conversation, import a TXT/VTT/SRT file, or choose **Try an example**.
   Include speaker names where available. The example is invented and loading it
   does not analyze it or save a meeting to history.
2. Choose the meeting date. A phrase such as “tomorrow” depends on this date.
3. Choose **Analyze transcript**. This saves the input and suggested tasks.
4. Open **Edit & evidence** on a task. Correct the task, owner, or deadline.
   **Unknown** means no value was identified. Check the source before filling it in.
   **What should I check?** explains the task, person, date, and missed-work checks.
   Attention flags identify missing/conflicting details; every suggestion still
   needs review, including those without flags.
5. Use **Locate passage** to inspect the original words. On a narrow screen the
   source opens automatically. **Back to task** returns to the originating control.
6. Select tasks to keep, then confirm. Unselected suggestions are rejected.
   Review edits autosave; confirmation locks the chosen plan.
7. Track tasks as To do, In progress, or Done. Use **All tasks** for work across
   meetings, or return to a conversation using **Meeting history**.
   **Activity** records changes. Progress does not rewrite confirmed evidence.

**Edit meeting** opens the input editor. Closing it preserves unfinished edits.
Input changes do not replace existing evidence or automatically run another analysis.

If no suggestions appear, check the saved conversation for missed work. **Add a
missed action** moves to a form where you can highlight the supporting words and
write the task, person, and date. Missing details can stay Unknown. The added
proposal starts unselected; check it above before confirming. An empty extraction
result is not proof that the conversation contained no actions.

## Correct a confirmed task’s deadline

Open a task from **All tasks**, **My day**, **Calendar**, or its meeting. Choose
**Correct deadline**, enter the new date (or select **No known deadline**), and give
a reason before saving. A correction requires a different date. It does not edit
the confirmed plan, task description, owner, or supporting transcript.

The task shows the current deadline, originally confirmed date, and latest reason.
**Activity** records every before/after date and reason. Calendar, My day, due-date
filters, copied plans, Markdown, and CSV use the current deadline. Plan exports
also include the original date and correction reason; raw history keeps all events.
If a date is Unknown, the task moves to Calendar’s **Unscheduled tasks** list.

A failed save keeps the submitted correction in this browser. Use **Retry deadline
correction** to recover the same request, including after a reload. If another tab
changes the date first, refresh the saved tasks and reopen the correction. An older
plan version is read-only. A follow-up comparison created before a deadline
correction cannot be confirmed: start a new comparison from the latest plan.

## Review a follow-up conversation

Open a confirmed plan and expand **Review a follow-up conversation**. Paste the
next conversation, choose its meeting date, then **Compare with this plan**. The
comparison is a separate saved draft; the existing plan remains active.

The review separates **Added**, **Changed**, **Cancelled**, and **Unchanged** tasks.
Use the category buttons to narrow the view. Check **Previous plan** against
**Proposed update**, correct the suggested fields if needed, and expand
**Check supporting passages** to inspect the original and follow-up words.

- Check **Add this task** to include an addition.
- Check **Apply this update** to replace an existing task's details.
- Check **Approve cancellation** to remove that task from the current plan.
- Leave a change unchecked to keep the old task, or skip a new addition.
  Tasks not mentioned in the follow-up remain unchanged.

The approved-change count and **Confirm updated plan** button stay visible while
you scroll through the comparison. Nothing is approved automatically.
**Confirm updated plan** saves your choices
and replaces the old version in **All tasks**. Existing task progress carries over;
new tasks start To do. The previous plan, its evidence, and its exports remain in
history. An earlier version links to the newer one and cannot receive new progress
updates. You can inspect the saved choices under **Review the changes behind this plan**.

Follow-up input autosaves in this browser; comparison choices also save to history.
If another tab changes a review, confirmation pauses. **Use saved review** replaces
your browser choices with the server-saved review. Competing follow-up drafts cannot
both replace the same plan; compare again against the current version if necessary.

Matching is conservative: repeated task wording can identify an existing task,
and a uniquely named reference such as “Move the report to Monday” can propose a
deadline change. “Cancel that task” only resolves an immediate same-speaker action
in the follow-up; it does not guess a task from the old plan. Ambiguous references
show a reminder and keep existing work. Broad paraphrases may appear as additions;
inspect both the task list and the passages before confirming. Missing details in a
repeated task do not erase previously confirmed owners or deadlines.

A follow-up contains the previous source plus the new conversation, with a dated
separator. The follow-up date resolves new relative deadlines; existing dates do
not shift. The combined source is limited to 100,000 characters and a comparison
to 200 tasks. Deleting a source erases every later version containing a copy of it.
Deleting a replacement does not reactivate historical tasks in All tasks.

[Example change review](screenshots/plan-changes-light.png).

## Find tasks across meetings

Open **All tasks** to see confirmed tasks. The initial view shows open work;
choose **All statuses** to include completed tasks. Search task descriptions,
owners, or current meeting names. **Today**, **Overdue**, and **Upcoming** use your
device's calendar date; Upcoming includes the next seven days after today.
Completed tasks do not appear in those date views. **Unassigned** finds Unknown
owners, including completed tasks when your status filter includes them.

View counts follow the current search and status filter. **Refresh tasks** checks
for changes from other tabs. **Open task & evidence** opens that exact task inside
its meeting, where you can change progress or use **Locate passage**. Task links
remain private to your account. Browser Back restores the dashboard filters during
the same session; reloading the dashboard starts with the default filters.

## Tasks by owner

Open **Tasks by owner**, beside **All tasks**, to see confirmed tasks grouped by owner
name. The initial view includes groups with open work. Choose **All owner groups**
to include completed-only groups, or narrow the list to overdue or unassigned work.
Search follows owner labels; it does not search transcript text.

These are names from your plans, not team accounts or verified identities.
Different spellings and capitalization stay separate; joint owner labels stay
together. Missing owners appear in **Unassigned**. No task is assigned automatically.

Each group shows open, overdue, due-today, in-progress, done, and no-deadline counts.
Date counts exclude completed tasks and use your device’s date and current saved
deadlines, including corrections. Summary counts follow both workload filters.
Unassigned comes first; other groups sort by overdue and open counts, then name.

**Start with** opens a priority task and its exact supporting evidence. **View open
tasks**, **View overdue tasks**, and **View all tasks** open All tasks with an exact
owner filter. That filter also respects progress and due-date views. Choose
**Show all owners** to clear it. Owner and task filters survive section navigation
and browser Back within the current workspace session; a reload starts default filters.
Use **Refresh owner overview** to reload saved progress and dates. Returning to the
screen or refocusing the browser also refreshes the overview. Viewing groups never
changes owners, tasks, or dates.

## See meetings and deadlines on the calendar

Open **Calendar** to browse a month. Meeting cards use the conversation's meeting
date; task cards use the current deadline, including any saved correction. The labels and colored borders tell
them apart. The calendar shows dates, without scheduling a time of day or sending
reminders. Dates do not shift with time zones.

Choose a date to see its entries. Use arrow keys between dates in the month grid,
then Enter to select. **Agenda** lists dates with events; small screens use this
view automatically. **Today** returns to your device's current date.

Choose **Meetings only**, **Tasks only**, or both. Task status filters apply only
to tasks; choose **All statuses** to include completed work. Earlier meetings
remain in history, while task deadlines follow the current confirmed plan.
Unconfirmed suggestions do not appear as task deadlines.

**Open meeting & transcript** returns to the saved meeting. **Open task & evidence**
opens the exact confirmed task, where **Locate passage** shows its supporting
words. Browser Back restores your calendar selection and filters in the same tab;
reloading starts at the current month. **Refresh calendar** checks for changes.

**Unscheduled tasks** lists confirmed work with an Unknown deadline, across all
months and using the selected task status filter. Page controls show further
entries on busy dates and in Unscheduled. The calendar never invents a deadline
or changes your saved plans.

## Share a confirmed action plan

Choose **Copy task** on an individual task in **All tasks** or a confirmed meeting
plan to copy its task, owner, and deadline. Unknown details stay **Unknown**.
If clipboard access is unavailable, select and copy the text shown in the card.

Once a plan is confirmed, choose **Copy action plan** or **Download Markdown**.
Group it by owner, deadline, or original task order. Exports contain all confirmed
tasks and their supporting passages, even when the on-screen task list is filtered.
Unknown owners and dates stay Unknown. Progress changes are separate from the
confirmed plan and do not change this export.

Expand **Preview action plan** to inspect the text. If copying is blocked, choose
**Select plan text** and use your device's copy command. Exported files and copied
text can contain private meeting information; you control where you share them.

## Group recurring meetings and prepare the next agenda

Open **Meeting history → Meeting series** and give the recurring conversation a
name, such as Weekly product sync. You can search and page through your series.
From a saved meeting, expand **Meeting series**, choose its group, and select
**Save meeting series**. Removing a group uses **No series**. A meeting and all
its reviewed follow-up versions share one choice; moving any version moves the
whole conversation family. Task contents, evidence, progress, and dates do not change.

Choose **Prepare next meeting** from the series or its saved meeting. The view shows:

- **Unfinished tasks:** all open tasks in current confirmed plans, using corrected
  deadlines and latest progress. Completed tasks and replaced plan versions are excluded.
- **Meetings:** every saved conversation and plan version in this series, including
  reviews awaiting confirmation. Links return to the original record.
- **Updates:** task progress, deadline corrections, and plan confirmations since
  the last available saved agenda. Before an agenda is saved, or after its source
  is erased, the view shows all recorded updates still available.
- **Saved agendas:** previous saved versions, with their title, save time, and
  read-only text. These are historical notes, not the current task state.

Counts cover complete lists; pagination limits the visible items. **Create agenda
from current tasks** includes every open task, not only the current page. If the
complete text is too long for one agenda, the app explains this and offers a blank
agenda instead of silently dropping tasks. Missing owners and deadlines stay Unknown.

Edit **Agenda title** and **Agenda notes**, then choose **Save agenda** to sync a
version to your private workspace. Before saving, edits stay in this browser and
tab. Interrupted saves retain their request for recovery. **Copy agenda** checks
current task details, membership, preparation date, and saved version first.
Changes require you to check the preparation or explicitly regenerate the agenda.
Regeneration asks before replacing your edits; blocked clipboard access offers
selectable text. Saving and copying do not schedule meetings or create tasks.

**Add next conversation** creates a separate meeting plan inside the series. To
revise existing commitments instead, open their meeting and use **Review a
follow-up conversation**. Independent plans are not automatically merged just
because they belong to the same series.

You can rename a series or choose **Delete series**, then type **DELETE SERIES**.
Deletion removes its name, agendas, and series history while keeping conversations
and plans. Deleting a source transcript also removes saved agenda versions that
used it, even if the meeting was moved out of the series afterwards. Online
browser caches containing that source are cleared too; separate downloaded copies
and other-browser copies have the same limits described under Data & account.
Small non-content version markers remain so erased agendas cannot reuse old save
versions. Workspace erasure also invalidates preparation freshness checks.

## Draft a follow-up message

In a current confirmed meeting, expand **Draft follow-up**, then choose **Create
follow-up draft**. It prepares a subject and editable message from the current
confirmed task descriptions, owners, corrected deadlines, and progress. Completed
tasks have their own section. Missing owners and dates stay Unknown and open tasks
with missing details appear under **Details to confirm**. No language-model API
is called, and transcript summary text is not used to invent extra commitments.

Edit the subject and message, then choose **Save follow-up draft** to keep a
version in your private workspace, available on other devices. **Activity** keeps
saved versions, and workspace exports/backups include them. Before saving, edits
are recovered in the same browser and tab, scoped to your account; they are not
included in workspace exports. Deleting a meeting removes its saved message
versions and associated browser drafts.

**Copy follow-up** checks the latest saved meeting before copying the subject and
body. If task details changed, check the current tasks and update the message,
then choose **I've checked the current tasks**, or regenerate it. Regeneration
asks before replacing your edits. A newer saved message from another tab is shown
for comparison; choose **Use saved draft** or **Keep my edits** before saving again.
A failed connection preserves the exact save request for recovery. If copying is
blocked, select and copy the displayed text manually.

You choose where to share the message and review its recipients there. Drafting,
saving, and copying do not send email or change the plan, task owners, or evidence.
Earlier plan versions retain their saved messages but cannot create new drafts.

## Understand review reminders

Open **Edit & evidence** to read **What to check**. Missing owners or dates can
remain Unknown. Invalid dates need a valid YYYY-MM-DD date or Unknown before
confirmation. **Different deadlines** means another proposal has matching task
wording, a compatible owner, and a different exact deadline. Compare both passages;
the app leaves the choice to you and does not automatically discard either task.
Reminders update as you edit. They do not establish that an extraction is correct.

## Label and review examples

An **example** is a conversation and its meeting date. Its **expected tasks** are
the answers you believe an extraction method should find. **Research tools →
Label & review examples** helps people create and check those answers.

1. Add practice examples, or import a conversation you have permission to use.
   For real material, replace identifying text and check the exact preview before
   importing. Related conversations should use the same group.
2. Open an example, enter your reviewer name, and start your session. Highlight
   the words supporting a task with a mouse, touch selection, or Shift + Left/Right arrow keys.
3. Enter the expected task, owner, and date; choose **Add labeled action**. Use
   Unknown for missing metadata and YYYY-MM-DD for a known date. Repeat as needed.
4. Submit your review before looking at other answers. Ask a separate person to
   review independently. Changing your reviewer name is not an independent review.
5. Compare submitted reviews and resolve differences with an explanation. Lock the
   agreed example set when it is ready for comparison. Locked answers cannot change.

Imports of bundled practice conversations exclude the original answers. Their
previous use in testing still means they are not unseen examples.

## Compare extraction methods

An **extraction method** finds tasks using rules or a language model. An **example
dataset** (also called a corpus) is a collection of conversations used to check it.

Use **Compare extraction methods** to read saved results. Choose an example set,
then click a method name to inspect conversations and compare expected tasks with
suggestions. Results are loaded from saved reports; opening the screen starts no run.
You can also explicitly run a comparison on your locked reviewed examples.

- **Expected tasks found:** how many reference tasks matched a suggestion.
- **Extra suggestions:** suggestions that matched no expected task. Inspect the
  conversation before deciding whether they are wrong; reference answers can miss things.
- **Owner/date matches:** correct values among matched tasks, including matching
  Unknown values. Detailed scores also count missed known owners and dates.
- **Typical time:** the median (p50) measured response time. Lower is faster.
- **API fees:** reported provider fees; computing costs are excluded. Unknown is
  different from zero.
- **Failures:** examples where the extraction run failed.

Expand **Detailed scores & how to read them** for percentage measures. Detection
score (F1) combines finding expected tasks with avoiding extra suggestions. The
passage support measure is approximate; it is not a semantic judgement that the
conversation proves a task. Not applicable means there were no relevant items.

**Practice examples** help improve a method. **Reserved test examples** are kept
separate to check it afterwards. Do not repeatedly tune a method against test
errors. Synthetic results describe the invented examples tested; they do not
establish real-meeting accuracy. Independent review and permitted real examples
remain useful next steps.
