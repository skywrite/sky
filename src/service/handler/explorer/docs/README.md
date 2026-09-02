---
created: 2026-08-30
updated: 2026-08-30
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

## The rules it lives by

- Nothing walks the whole notebook: a directory is listed when it is
  opened, a file read when it is looked at.
- Only what the roots allow: every path is checked against the notebook
  root and the configured directories before anything is read.
- A directory's rows are plain links. The app turns the page in place;
  a middle click still opens a tab.
- The buttons in the header — Edit, Details, the ⋯ menu — belong to a
  file. A directory's page has none.

## Verified

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
