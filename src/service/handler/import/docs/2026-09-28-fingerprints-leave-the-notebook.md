---
created: 2026-09-28
updated: 2026-09-28
---

# Fingerprints leave the notebook

**What was wrong.** The append door (2026-09-27) made a repeated drop or a
retried import idempotent by keeping each clip's sha256 in the conversation's
frontmatter, as an `audioClips` list, and told the properties panel to hide the
row. A day later the owner opened a conversation raw and asked what the list
was. It was machine bookkeeping in a person's document: a hash is unreadable,
it duplicates what the transcript run already knows, and the only reason it
was in the file is that the run is cleared when the door files the document.
The panel having to hide it was the tell.

**Rejected.**

- Dropping the check. A retry after a crash between the write and the job
  settling is exactly the case it exists for, and a double drop would leave a
  duplicate turn that Undo removes only while the import is still around.
- Keeping the hashes in the transcript run. The run is deleted on completion
  and forgotten after thirty days by design; a record that must outlive the
  run does not belong in it.
- Reading the old `audioClips` list as well, forever. The few conversations
  that carried it, one day old, are stripped by a one-off script rather than
  keeping a reader for a format that should not have existed.

**Why the fix works.** `message/_lib/filedAudioClips.ts` keeps one record per
clip under `state/transcript/filed/<sha256>.json`, listing the conversations
that hold a turn from it. The writer checks it under the same lock as the file
write, records after the write so a failed write cannot mark a clip filed, and
Undo forgets what it removed. A lost record admits at worst a duplicate turn.
The rule it leaves behind: before a writer adds a frontmatter key, ask whether
the person would type it; if not, it is state.
