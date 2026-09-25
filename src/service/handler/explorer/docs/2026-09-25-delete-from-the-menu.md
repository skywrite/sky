---
created: 2026-09-25
updated: 2026-09-25
---

# Delete from the ⋯ menu

2026-09-25. The ask: from a document open in the explorer, the ⋯ menu
deletes the file, and when the file's day lists it, the day's line goes too.

## Before

A file open in the explorer could be read, edited, exported and have its
path copied. Getting rid of it meant the Finder or the terminal — and the
day that captured it kept its line, `- 09:15 > Notes -> [Title](notes/…)`,
pointing at nothing.

## Now

- **Delete is the last item of the ⋯ menu**, set off by a divider and read
  in the danger color, the way "Delete from here…" reads on a chat
  question. It is there while reading; while editing, Done comes first,
  because the editor holds the file and its autosave would write it back.
- **The file goes to the Trash**, not away: the same move the day's Files
  page makes for an attachment, so it can be put back by hand later. Off a
  Mac it lands in a `trash` folder under the user-data directory.
- **The day lets go of its lines.** A file under a day directory belongs to
  that day. Every row of the day file whose own line links to the file —
  the capture line, a to-do that names it, an MI line — leaves, nested notes
  and all, and the definition of a reference link stays. A link in a note
  nested under some other item never takes that item away: only the line
  that is about the file goes. A list left empty keeps the bare `-` the
  template gives it. The day file itself, and a file outside the days, only
  go to the Trash.
- **The page turns to the folder** the file was in, the tree lists that
  folder again without it, and a toast at the foot of the column says what
  happened — "Moved “09-15_Roadmap” to the Trash, and off Wednesday,
  January 28, 2026" — and holds **Undo** for eight seconds.
- **Undo puts the file back** out of the Trash and its lines back on the
  day, each where it was (or last, when the list has moved on), and opens
  the file again. Undo of a delete whose file has since left the Trash says
  the file has moved on.

## How

- `explorer/remove.ts` — `POST /explorer/_api/remove {path}` and
  `POST /explorer/_api/undo {moveId}`. The path is checked the way every
  explorer read is (inside the notebook, under a root, a `.md` file). The
  day is read off the path with `parseTimePath`; its lines are found by
  resolving each row's link targets — inline, `<…>`-wrapped,
  percent-encoded, or by reference through the file's definitions — against
  the day's directory, and taken out with the day page's own `removeBlock`
  / `insertBlock`, so whole blocks travel. The day write takes the day
  page's lock (`day-<ymd>.lock`) so the two never overlap. The file moves
  first; a day write that fails moves it back, so nothing is half done. A
  delete is remembered for ten minutes under its `moveId`.
- `attachments/keep.ts` — `trashFile` and `defaultTrashDir`, lifted out of
  `day/files.ts`, which now calls them.
- `http.ts` — `trashDir` on the app's options, passed to both; the test
  helpers point it at a `.trash` folder inside the temp notebook, never the
  Mac's Trash.
- `theme/client/explorerDelete.tsx` — the calls, the toast and its
  sentence, and the `sky-explorer-changed` window event the tree listens
  for to list a directory again in place. `explorer.tsx` holds the menu
  item, the delete and undo flows, and turns the page through `go`, which
  `main.tsx` now passes in.

## Verified

2026-09-25. Unit, `explorer/remove_test.ts` (5): a captured note leaves
for the Trash and its two lines leave the day, nested thought included,
neighbours and the reference definition kept, the emptied list keeping its
slot; Undo restores the day byte for byte and puts the file back, a second
Undo finding nothing; a reference-linked message and a percent-encoded name
each lose their line; a project file and the day file itself name no day;
outside the roots, a missing file, a directory, an absolute path, no path,
an Undo after the Trash was emptied and an Undo of nothing are each refused
with their own status. Typecheck, the explorer and day-files suites, and
`dev:check` green.

E2E, `http-explorer-delete-e2e_test.ts`, headless in Brave: ⋯ → Delete on
a day's note turns the page to the notes folder with only the other note
left, the tree lists the folder again without it, the toast reads "Moved
“09-15_Roadmap” to the Trash, and off Wednesday, January 28, 2026", the file
is in the stand-in Trash and its line is off the day; Undo opens the note
again with its line back, the tree whole, the Trash empty, and no browser
errors.
