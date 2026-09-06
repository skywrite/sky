---
created: 2026-09-06
updated: 2026-09-06
---

# Finished imports leave

Every upload made a directory under the imports store: the file and a
`job.json` beside it. The rail stopped showing filed imports and refused
files on 2026-09-03, but the store kept every one of them — thirty filed
imports and a refused file were on disk three days later, with their
uploads.

Now a job that has nothing left to offer leaves. A filed import's write-up
is on the day; a refused file was never work. Both go ten minutes after
they settle, at the next look at the list, upload and all — the dialog
that watched the run has had its moment to show what was filed or why the
file was refused. A restart clears them at once: whatever the dialog was
showing is gone with the process anyway.

Failed and cancelled runs stay. Their row is in the rail's Working section,
and a Start picks the run up where it stopped. The job's `settled` stamp
says when it settled; a refused file is settled from its arrival.

The sweep runs on `GET /import`, which the page asks for regularly, so
nothing runs on a timer and a test drives it with a clock of its own
(`ImportRoutesOptions.now`).
