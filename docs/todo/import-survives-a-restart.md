---
created: 2026-09-06
updated: 2026-09-06
---

# A waiting import survives a restart

## The problem

An import that has stopped to ask the person something — which speakers
are who, what day it belongs to — waits on a resolver held in the service's
memory. A restart drops it. The import store marks the job failed on boot
with "Sky restarted while this waited for you. The file is still here.",
and the dialog offers to pick the run up from its record. Honest, but the
question the person was answering is gone with the process.

## The shape of the fix

The pipeline's record already knows the step it stopped at. Persist the
open question with the job, and on boot leave such a job in its waiting
state; when the person answers, resume the pipeline from the record rather
than resolving a promise that no longer exists. A job that is actually
running when the service goes down still fails, as now, since the process
that ran it is gone.

## What it trades

Import pipelines must be resumable at a question, not only from the start
of a step. The import lane's rung, named 2026-09-05.
