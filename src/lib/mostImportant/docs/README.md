---
created: 2026-09-20
updated: 2026-09-21
---

# Daily Most Important creation

The terminal and day page share the suggestion, interview, synthesis, and save
steps in this module. The existing prompt IDs under `commands/all/mi/prompts/`
remain their customization points. AI is the default; a supplied task bypasses
suggestions, not the interview and review. The non-AI CLI questionnaire remains
available explicitly.

The interface initially shows the strongest recommendation and two alternatives.
More reveals the other candidates and can request different ones; writing a task
is always available. Questions respond to the task and notebook context, one at a
time, with at most three and usually zero or one. They clarify scope, audience,
or completion; a question that requires analysis, drafting, or the task's actual
decision belongs in the work, not this interview. A clear task proceeds directly to drafting.
The answers are source material for concise AI writing, not text to reproduce
in the saved document. The title is a short action. The body explains the intended
work, its specific reason, and what completion means, retaining context and scope
that help the owner act. There is no fixed word budget or mandatory section checklist:
both a generic stub and a source-document recap lose the purpose of the task.
Refinement receives the current edited draft and preserves the owner's intent,
direct edits, and recorded results; shortening removes repetition and digressions.
This workflow does not schedule work; a deadline is
optional and distinct from a start time.

The chooser uses short action titles and one-sentence reasons; background stays
behind a disclosure. The day page streams context, thinking, and writing stages
over SSE, with heartbeats while the model is quiet. Only real work advances a
stage; the client's changing captions and elapsed time never mark work complete.
The validated final result is the same object returned to JSON and CLI callers.

The open composer renews a service activity hold across the whole interaction,
including time spent answering and reviewing. Closing, saving, or discarding
releases it; a lost tab's lease expires after two minutes. Each generation and
save also holds the service until its response finishes, even if the page leaves.
Automatic restarts therefore wait for the creation flow to finish.

## Accepting and completing

Only accepting a reviewed draft creates a notebook record. Browser drafts and
answers survive navigation and reload in the tab's session storage; they are not
part of the MI file. The title, optional deadline, and editable Markdown form the
final document. A missing day is created as an unstarted plan when accepting it,
without running day-start routines.

Saves take the same planning/day locks as other day writers. Names retain the
established daily ordinal: `MI1_Summary.md`, `MI2_Summary.md`, and so on. Allocation
accounts for existing files and pending saves; atomic file claims never overwrite
another record. Blank `MIn.md` files and timestamp names remain readable.

AI and non-AI creation use the same frontmatter writer: `summary`, `complete`,
`dateStarted`, `rel`, and `tags`. Empty values stay bare, including `dateStarted`;
creation is not evidence that work has started. An explicit deadline belongs in
the document body. Existing metadata, including custom keys, survives completion
updates. Save identifiers, hashes, counters, and progress are not document headers.

The file and day link are separate writes. A receipt under the private planning
state directory binds a retry key to the draft and reserved filename. The draft
stays there until its day link is written, then the complete notebook file is
published atomically and the receipt records success. A failed publication rolls
back only an unchanged day write; a crash or lost response can be recovered by
retrying the same save. A successful save never overwrites later document edits
or recreates a day item the user has removed.

The day checkbox and `day:items:done` update the linked MI's `complete` field as
well as the day row. A failed day write conditionally restores the MI's old bytes;
notes and custom sections stay intact. Source links must remain inside the
notebook's time directory and may not traverse symlinks. Existing context gathering
then gives later suggestions the completion state, without a separate close-out
interview or an automatic rollover.
