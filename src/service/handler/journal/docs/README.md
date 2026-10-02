---
created: 2026-10-02
updated: 2026-10-02
---

# Focused browser journaling

Today and dated day pages open `/<day>/journal`; the current topic resolves to
`/<day>/journal/<topic>` so direct links, reloads and browser history identify
the same reflection. Saved reflections created here reopen in this view.
Existing CLI journals remain ordinary documents. The shared WYSIWYG engine is
embedded by `theme/client/markdownEditor.tsx`; writing does not require Explorer.

Health and Mood load the selected day's recurring questions, including their
subquestions, with defaults for a new notebook. They remain available even if
AI setup or generation fails. One AI pass considers the complete set and
recent notebook context, selecting up to five optional, distinct invitations.
There is no per-category file quota. Source cards retain only exact quotations
from documents actually read. The observation connecting them remains an AI
interpretation. The CLI gather is uncapped, so the browser bounds the model
request to source excerpts, retaining pinned documents and giving remaining
room to the most recent material. Long documents contribute an opening and
closing excerpt; quotes are still verified against their original text.
Go deeper uses the saved answers across the session; regular
questions and reflections with writing cannot be automatically set aside.

## Suggestions are private state; answers are notebook files

`lib/journal/` owns the domain model, Markdown boundaries, storage and worker.
The day's session lives under the notebook-specific local user-data state
folder. Opening a page is read-only; starting creates session state. A question
creates a Markdown file only when its first nonempty answer is saved. Passing,
reframing, generation and empty answers never create placeholder files. Each
reflection gets one file under the selected day; follow-ups share that file.
Autosave starts with the journal type. Next and Done use the audio/video naming
helper to name it `Type_Summary.md` and write the summary to frontmatter. The same
journal tag and relationship helpers enrich the written answers, preserving
existing tags, links, and other frontmatter. A private fingerprint avoids
repeating enrichment until the writing changes; enrichment never renames an
already named file. Model results are applied only if the answers still match.
Naming failure uses a descriptive fallback from the answer. The name then stays stable
unless the owner requests Rename summary. These files remain readable
without the private session state, but session resume currently uses that state
on the same machine.

A short process lock serializes session updates. First saves reserve a filename
in durable state and publish it atomically without overwriting a collision. An
ambiguous interrupted first save requires review instead of overwriting or
duplicating a file. Rename intentions also live in private state so interrupted
renames can finish safely. Notebook files contain ordinary question headings,
not internal comments or IDs. Their publication order stays in private state;
only those known headings delimit answers, preserving other headings and code
inside the writing. Missing or ambiguous published headings require reviewing
the file instead of silently appending another answer. Earlier browser files are
read compatibly and lose their bookkeeping comments on saving or finishing.

Answer writes use the shared Markdown write lock, compare the answer's content
version and preserve other answers and raw-file additions. Force replacement
requires an explicit browser choice and still cannot bypass structural conflicts.
The editor keeps a browser recovery draft until the service acknowledges a save.
Next and Go deeper flush the active writers. Unchanged polling leaves the editor
DOM intact; changed saved content refreshes only a clean editor.

## Question generation outlives the page

Question generation uses the shared [detached job runner](../../../../lib/jobs/docs/README.md).
The session records progress and a request ID before spawning. Retries with the
same ID do not create another producer. HTTP restarts and navigation do not
cancel generation; a stopped worker produces an actionable retry state. The
model runs outside session locks so writing remains available. Before applying
a follow-up, the worker checks the complete answer snapshot again. If writing
changed while the model ran, it preserves the new writing and asks for a fresh
follow-up instead of attaching a stale one. A nullable follow-up is a valid
stopping point, not a generation failure.
