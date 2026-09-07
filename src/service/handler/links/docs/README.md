---
created: 2026-09-06
updated: 2026-09-07
---

# Links between notebook records

`links/` owns the picker shared by imports and a document's `rel` property.
The client lives in `theme/client/links.tsx` and uses the existing modal,
phone drawer, colors and typography. Links stay as ordinary YAML references.
Saved links show the primary name or title with a small type icon beside it.
Dates, participants and branch details remain available in the picker.

## Choosing a record

`GET /docs/_api/links` searches the existing markdown index by title,
aliases, summary, people, tags, date and path. Exact names and aliases rank
first, followed by name/title prefixes, word prefixes, substrings, then
contextual matches. Dates break ties within each relevance tier. The person
appears once under their canonical name, whichever alias found them.

Type and date filters and relevance ranking apply before pagination; each
page has forty records. Searches display in relevance order. Empty search
lists recent records grouped under Today, Yesterday or their full date,
anchored to notebook time. The current document is excluded. Search errors
remain visible.

Videos, meetings, messages, journals and saved chats receive specific type
labels. A chat branch is its own record, showing its parent title and turn.
The index includes descendants at every depth. Preview reads the chosen
record in the picker; opening the full record uses a separate tab.

Time records use the same references as VS Code:
`2026-01-27/actions/videos/Loom_Atlas`. These resolve through the notebook
store regardless of the week-folder layout. Names and project references
retain their existing forms. `/resolve` supplies readable labels for saved
values, including older spellings that resolve to the same file.

## During an import

`POST /import/:id/links` records explicit selections on the persisted job.
It is available before Start and while running or reviewing. A `links` SSE
event keeps the open page current. Selecting a record does not feed it to
transcript analysis or alter the write-up.

Selections and the filing handoff serialize per job. Once the command has
written its result, the latest selections merge into `rel`; extracted
relations remain. Retries deduplicate by resolved target. A failed link save
leaves the filed result available with a retry action, without rerunning
the command. That job stays across cleanup and restart until its links save.
After filing, the document's normal editable Details section
provides the same picker.

The writer validates notebook boundaries, resolves filesystem aliases,
preserves other YAML properties and the exact markdown body, and uses the
editor's version check. The index is updated after saving so the earlier
record's Linked from section reflects the new connection immediately.

## Verification

`catalog_test.ts` covers name/title relevance, contextual matching and
filters. `links_test.ts` covers aliases, ranking before pagination, branches,
reference resolution, metadata preservation, backlinks, validation, resume
and a selection racing filing. `../http-links-e2e_test.ts` exercises person
search order on desktop and phone, keyboard selection by alias, a video
import before Start, a branch added during review, reload and previews.

## Notes

- [2026-09-07 — names before incidental matches](2026-09-07-names-before-incidental-matches.md)
- [2026-09-06 — links across an import](2026-09-06-links-across-an-import.md)
