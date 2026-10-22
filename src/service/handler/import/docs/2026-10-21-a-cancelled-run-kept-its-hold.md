---
created: 2026-10-21
updated: 2026-10-21
---

# A cancelled run kept its hold

A restart waited fifty minutes on `import` while the import list showed nothing running.
The list held only uploads that were never started; the run holding the restart had no row at all.

## What went wrong

A meeting import of a transcript stopped at the names check to ask the person a question, and waited there for two and
a half hours.
Only today's *Working* list shows an import that needs the person, and they did not see it there, so they dropped the
same file again.
The second run picked up the first one's kept analysis from the shared run record, asked the names check again, and
filed the meeting.

Then the first run was cancelled, and its row removed.
The cancel answered its open question with null, and the run went on into the write-up with its signal already fired.
The model library ends a cancelled stream quietly: it does not throw or call `onError`, and the loop ends with whatever
text had arrived, here none.
The pipeline kept that empty write-up in the run record as a finished stage, kept default fields when the extract
failed on the abort, and moved on to the write-up check.

The runner's prompter answers the questions open at a cancel with null, but it did not answer one asked after it.
The route stops relaying a cancelled job's events, so no page saw the question and the command waited on it forever.
The import's hold is released only when the run ends, so it never let go.
The restart waited for a quiet moment that could not come, and the status said only `import`, with no file to look for.

## The fix

- `EventPrompter` (`commands/lib/core/runCommand.ts`) answers null at once any question asked after a cancel.
  A command on its way out never waits on a page that will not ask.
- The write-up stage checks the signal before it keeps its text, and the extract stage no longer reads a cancel as a
  failed extraction and keeps default fields (`commands/all/audio/transcript/summary.ts`).
  A stage a cancel cut short keeps nothing, so a rerun redoes it instead of filing a stub.
- The hold is named for its file (`file import: atlas.vtt`).
  `GET /service/status` and the sidebar say which run a restart waits on, even once its row is gone.
- An import waiting on the person shows in the sidebar on every page but its own, with Review
  (`ImportsWaiting` in `web/client/import/import.tsx`).
- One run per file (`JobStore.live`): the same file dropped while its import runs or waits opens that import, with a
  line saying why, and a second upload staged earlier cannot start until the first ends.

## Rejected

- **Releasing the hold at cancel.** A cancelled run can still be mid-write, filing the meeting it had started.
  A restart under it would cut that write in half; the hold has to last until the run ends, so the fix makes it end.
- **A signal check before each question.** Commands ask in many places; one guard in the prompter covers every one,
  including questions added later.
- **Refusing the second drop.** The person dropped the file again to find their import; opening it is the answer.
