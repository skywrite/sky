---
created: 2026-08-30
updated: 2026-09-06
---

# Explorer — the notebook's files as pages

Design notes for `src/service/handler/explorer/` and the page it serves,
`theme/client/explorer.tsx`.

## What is built

The explorer is the notebook on the web: a tree in the sidebar, and the
column showing the page the URL names. A page is its path —
`/explorer/projects/Atlas.md` is that file rendered to read (or, after
Edit, open as blocks); `/explorer/projects` is that directory as the
files it holds, one row per entry; `/explorer` itself lists the roots.

- `mod.ts` — the wire types and routes. `GET /explorer/_api/dir` lists
  one level (the roots without `path`, a directory's entries with);
  `GET /explorer/_api/doc` is one file rendered — frontmatter kept
  aside, comments left out, relative images and file links pointed at
  the file API.
- `theme/client/explorer.tsx` — the tree, the reading column, and the
  editor mount. The column resolves its path as a file first, then as
  a directory, and re-reads whichever it shows every few seconds, so a
  save or a new capture from another session lands in place.
- `theme/client/frontmatter/` — the identity line under the title and
  the rail beside the document: tags, links, what links here, files,
  the outline, the raw YAML behind a switch. The rail's Files section
  lists `attachments:` and, while editing, adds to it — a pad to drop a
  file on, or a dialog of what is beside the document to tick, with a
  way in from this Mac; a brought-in file's original moves in when this
  Mac has it — see `2026-09-02-add-a-file-from-the-rail.md`.

## The rules it lives by

- Nothing walks the whole notebook: a directory is listed when it is
  opened, a file read when it is looked at.
- Only what the roots allow: every path is checked against the notebook
  root and the configured directories before anything is read.
- A directory's rows are plain links. The app turns the page in place;
  a middle click still opens a tab.
- The buttons in the header — Edit, the ⋯ menu, and the rail's chevron
  while the rail is folded — belong to a file. A directory's page has none.

## Verified

2026-09-06: completion names and hints occupy separate lines in a bounded,
scrollable menu, with a soft selection highlight and full text on hover.
Selection happens after the menu opens so the first result is visible on
reopening. See `2026-09-06-completion-rows-keep-their-shape.md`.

2026-08-30: directory pages added — a dir URL had answered "There is no
file at…". Route tests (`explorerRoute_test.ts`), typecheck and lint,
plus a live headless-browser run: a directory listed, a row click
opening the file in place, back returning to the listing, the roots at
`/explorer`, and a path that names nothing still saying so.

2026-09-01: the who field's suggestions showed rows of earlier answers on top
of the current one, several people twice. One row per document from the
vocabulary, rows keyed by document, and only an answer to the search so far
shown — see `2026-09-01-ghost-rows-in-the-who-field.md`. Unit tests, then a
headless run against the live service with writes blocked: the dropdown holds
exactly the server's rows and React logs no key warning.

2026-09-01: the panel remembered every completion and name resolution for the
page's life, so a hint could name a state the notebook had left long ago. An
answer now stands in for ten seconds — a burst of typing — and is asked again
after; see `2026-09-01-completion-answers-expire.md`.

2026-09-01: every `when` row read "not a date or a range" in a browser
without `Temporal` — Safari, Firefox, an older Chromium — because the date
helper behind the hint reached for it even for a full date; see
`2026-09-01-when-row-without-temporal.md`.

2026-09-02: a file could be taken off a document's list in the rail but not
put on it. The Files section now carries a pad while editing, and a dialog
of what is beside the document to tick, with a way in from this Mac: the
original moves in when this Mac has it, else a copy lands; either way the
name joins `attachments:` — see `2026-09-02-add-a-file-from-the-rail.md`.
Route and model unit tests, and a headless run through the rail: the dialog
listing the day's files with the listed one marked, a chosen file moved out
of the stand-in Downloads folder and listed, a ticked one listed, bytes from
nowhere copied and listed, Remove unlisting.
