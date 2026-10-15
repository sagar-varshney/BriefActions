# Using Productivity Flow Engine

Start with **Extract & review**. The research tools are optional; you do not need
a machine-learning background to turn a meeting into tasks. Open **Help** anywhere
in the workspace for a short walkthrough and glossary. You can close or skip it
without changing your work, and open it again later.

## Turn a conversation into tasks

1. Paste a conversation, import a TXT/VTT/SRT file, or choose **Try an example**.
   Include speaker names where available. The example is invented and loading it
   does not analyze it or save a meeting to history.
2. Choose the meeting date. A phrase such as “tomorrow” depends on this date.
3. Choose **Analyze transcript**. This saves the input and suggested tasks.
4. Open **Edit & evidence** on a task. Correct the task, owner, or deadline.
   **Unknown** means the conversation did not provide that information.
5. Use **Locate passage** to inspect the original words. On a narrow screen the
   source opens automatically. **Back to task** returns to the originating control.
6. Select tasks to keep, then confirm. Unselected suggestions are rejected.
   Review edits autosave; confirmation locks the chosen plan.
7. Track tasks as To do, In progress, or Done. Return using **Meeting history**.
   **Activity** records changes. Progress does not rewrite confirmed evidence.

**Edit meeting** opens the input editor. Closing it preserves unfinished edits.
Input changes do not replace existing evidence or automatically run another analysis.

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
