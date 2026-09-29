---
created: 2026-09-28
updated: 2026-09-28
---

# Recorded journals

Audio and video journals share `lib/recordedJournal.ts` after the existing
`audio:transcript:clean` pipeline finishes transcription and names review.
Type detection must use the corrected recording; the import's opening preview
only chooses the kind of record. The web importer starts `journal:new` with
`--from-audio --split`, then renders the command's journal-type multiselect.
Suggestions are checked, existing custom types and new-notebook defaults are
available, and an unchecked topic stays in the remainder entry. Selecting no
types keeps one complete entry.

`recordedSections.ts` asks for section boundaries as exact opening phrases and
slices the corrected text in code. A boundary that cannot be located fails
before filing. The video split's grouping functions allocate every section
exactly once and reunite returns to a topic. Each entry gets its own short body
summary, plus a specific title from the naming helper shared with
`journal:rename`. Naming failure retains a descriptive fallback. Filenames are
allocated once with second-precision creation time in the notebook timezone,
case-preserved titles, and atomic collision handling; their filing day is the
chosen recording day.

One copy of the source recording is retained in that day's attachments and
referenced by every entry. Retention must succeed before filing. It uses the
shared attachment copier's atomic publication and content deduplication; an
import retry must not overwrite a namesake or leave journals pointing at an
upload that the import sweeper will delete.

The transcript run's `journal` checkpoint keeps sections, suggestions, accepted
types, names, the attachment, and each allocated document and its filing state.
A partially filed retry preserves previously saved entries and their edits.
The command returns every saved path, including partial results on failure.
The import host persists those paths and applies the Links selection to each.
Only the browser tab that started or accepted the import attempts to open the
Explorer tabs on completion; replayed events and polling must not reopen them.
All result links remain available when browser popup settings block that attempt.

The web transport and import lifecycle are documented in
[the import README](../../../../service/handler/import/docs/README.md).
