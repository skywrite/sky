# A few questions to get the notes right

2026-09-24. The ask: after a voice memo is imported and the transcription
errors are corrected, ask a few optional follow-up questions, especially
about the Loose Ends, so the notes come out clearer.

## What the notebook showed

The meetings filed from voice memos each carried a few loose ends.
Most were one of three things the write-up could not tell:
whether something was decided or only thought aloud,
what a referent meant, and what a stated step came with.
Some also carried a clock discrepancy, parked there by mistake.

## What was ruled

- A question exists only to make the notes accurate about what was
  said or meant. The answer must change how the note reports the meeting.
- Asking who does what by when is planning, not the notes.
  It is out, and so is any owner-and-when question.
- A stated meeting time is the time field, never a question,
  never a loose end.
- Every question is optional, each can be skipped, never more than three.
- The answers fold into the write-up; each question is drafted knowing
  the answers before it.
- Voice memos only. A transcript is everyone's words; the person cannot
  say what someone else meant.

## What was built

`audio/transcript/lib/clarify.ts`, called by `meeting:new` after the
pipeline returns and before filing. One model call drafts each question
from the words, the write-up, and the exchange so far. One model call
folds the answers in, marking each "Clarified after the meeting". A fold
that comes back empty leaves the answers under their own heading. The
exchange lives in the run record as the `questions` stage. The page
shows the words above each question, with Skip, Answer, and Skip the rest;
the terminal takes Enter to skip one and Esc to end them.

## Not done

The action items still come from the extraction before the questions.
An answer that recalls an owner named in the meeting reaches the note,
not the action-item review.
