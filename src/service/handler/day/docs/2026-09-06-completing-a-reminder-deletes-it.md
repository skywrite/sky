---
created: 2026-09-06
updated: 2026-09-06
---

# Completing a reminder deletes it

The web day page used the task checkbox action for reminders. Checking
"Water the plants" wrote `~~Water the plants~~` into the Reminders list,
then hid the row. The page looked cleared while the file kept the reminder.

Reminder completion now uses the existing delete action. The row collapses
without a strike, its line leaves the day file, and the toast still says
"Reminder cleared". Undo uses the position returned by deletion to restore
the line. A task's Undo still removes its strike.

The existing delete operation preserves neighboring lines and leaves a
bare `-` when the list becomes empty. Completion and explicit deletion
therefore keep the same file behavior, including restoration into an empty
list.

`http-day-items-e2e_test.ts` clicks the reminder checkbox in a real browser
against a temporary notebook. It checks removal and exact restoration both
between other reminders and in a list with only one reminder. An identical
to-do verifies that the list heading still scopes the write and that task
completion continues to strike the task.
