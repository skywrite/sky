---
created: 2026-09-05
updated: 2026-09-05
---

# A file dropped on its meeting

The day already imported transcripts and recordings, but a drop on an
unrecorded calendar row carried no more context than a drop on the page.
The dialog proposed the file's time and the listener could choose a
journal, even though the person had aimed at a particular meeting.

The row now owns the drag and drop, with a blue highlight in place of the
page overlay. Both handlers still see the bubbling event so both can
clear their drag state; only the owner queues the file. The existing
attachment pad follows the same ownership rule.

The queue holds the meeting with each file, rather than a shared last
selection. The dialog uses that slot's date and start, selects Meeting,
and treats the choice as a hand that the listener must not override.
For example, a recording dropped on the Atlas sync at 09:30 on a past
day imports there, regardless of when the recording file was saved.

Comparing the dialog's time against the proposal was insufficient: the
two can agree while the person's explicit choice still needs to beat a
time mentioned in the recording. Start therefore carries `whenStated`;
the command receives the chosen time as a stated argument. Retrying a
stopped job restores its fields and preserves that fact.

The browser regression uses a temporary notebook, a synthetic calendar,
and scripted import commands. It checks the highlight, nested row drops,
VTT and M4A source doors, a conflicting audio guess, the chosen date/time,
and an ordinary page drop afterward. The argument regression covers an
explicit slot whose time happens to equal the proposal.
