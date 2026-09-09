---
created: 2026-09-07
updated: 2026-09-07
---

# Put the reply back in Outbox

The complete-today check fixed discovery but its triage adapter only returned
summaries and questions. It explicitly removed the draft, so even a useful model
judgment left the owner with the work of writing. Deferring a separate voice
agent did not mean deferring the proposed response.

The triage contract now includes the actual reply. Routine wording is Sky's job;
only a meaningful decision or missing fact should block a complete message.
Those cases get a specific question and, when useful, a recommendation and
concrete response options. Drafts contain no placeholders or invented choices.

Picking an option or supplying rough direction composes a local review draft.
The same interface can shorten or warm an existing reply, including unsaved
edits. These actions never place a native draft. Revision and context checks
surround generation; a later human edit or new message invalidates an obsolete
result. Owner-directed text is protected on subsequent scans.

Simply updating the prompt would leave already-checked blank items cached. The
policy version changes too, allowing today's untouched items to be reassessed
without overwriting edits or approved replies. An SDK adapter test catches the
original failure of discarding generated wording; a browser regression carries
a synthetic decision through a response option, refinement, and explicit native
handoff.
