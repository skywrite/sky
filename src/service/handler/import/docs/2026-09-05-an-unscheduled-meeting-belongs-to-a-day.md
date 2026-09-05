---
created: 2026-09-05
updated: 2026-09-05
---

# An unscheduled meeting belongs to a day

An individual calendar row already supplied a meeting's date and time,
but an unscheduled meeting had only the generic page drop. Its file's
timestamp could put it on a different day from the one being viewed.

The Meetings section now owns drops outside its individual row targets.
Its heading and open area light the entire section blue. The closest
target owns both the highlight and the upload: entering a row clears
the section highlight, and all ancestors clear their state on drop.

A queued meeting can carry either a slot or just a day. For a day, the
dialog waits for the upload's time proposal and combines its clock with
the selected day. This keeps the time editable without letting the file
choose another date. Start uses the existing explicit-time argument.
The section remains available even without a readable calendar.
