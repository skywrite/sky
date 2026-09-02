---
created: 2026-09-02
updated: 2026-09-02
---

# Add a file from the rail

JP, editing a document with the rail open (2026-09-02): "by 'file', I mean
attachments… I can easily remove a file. But there's no way to easily add a
file. We need to do that." Then, on the first build: "I want to be able to
also choose files from the attachments dir too… some dialogue that pops up
on 'choose files' that allows me to choose files in the dir OR can 'upload'
a file which just moves it to the dir."

## Before

The rail's Files section listed the document's `attachments:` as chips, each
with a ×. That was all it did. A file got onto the list by being pasted into
the editor, or by a capture writing it; a document without the key had no
Files section at all. And a file the day already held — kept from the day's
drop pad, or attached by another capture — could not be put on a document's
list without typing YAML.

## Now

- **While editing, the Files section is always there**, with a pad under the
  chips: "Drop a file here, or choose files…". Reading, the section shows
  only when the list has something on it, as before.
- **"Choose files…" opens a dialog of what is beside the document already**
  — the files of its directory, by name, with a kind chip and a size. The
  ones the document lists are ticked and marked "listed"; the rest can be
  ticked and added with one button. Nothing moves or copies for these: the
  name simply joins the list.
- **"From this Mac…" in the same dialog brings a file in.** The service looks
  for the original from the three facts a chooser or a drop hands over —
  name, size, modified time — the way the day's drop pad does (see
  `../../day/docs/README.md`): the Desktop and Downloads first, then
  Spotlight. Found, it is renamed in and nothing uploads. Not found, the
  bytes go up and a copy lands, deduplicated by content. Dropping on the pad
  is the same path without the dialog.
- **The file goes where the document keeps its files** — a day document's
  into `attachments/YYYY/MM/DD/` under the user-data directory, any other
  document's into the user-data mirror of its directory — and its name joins
  `attachments:` as `- { file: "…" }`, the shape every capture writes. The
  chip appears as the file lands, and links to the file.
- **A note says which happened** — "Moved “deck.pdf” here from Downloads",
  "Kept a copy of “notes.txt” here", "Listed “chart.png”" — and holds Undo
  for eight seconds after a move. Undo puts the file back where it was and
  takes it off the list.
- **Remove (×) is what it was:** the name leaves the list; the file stays on
  disk.
- **On a phone** there is nothing to drop, so the pad is the chooser, and
  the dialog is a sheet from the bottom.

## How

- `attachments/keep.ts` — the look, the move and the undo the day's files
  already had, lifted out of `day/files.ts` so a document's attachments share
  them, and the directory listing with them. Each caller names the directory
  a file lands in; the look's token and the move's undo handle work the same
  for both. `day/files.ts` keeps its routes and calls it.
- `attachments/routes.ts` — `GET /docs/_api/attach/<doc>` (the files beside
  the document), `PUT …/attach/<doc>?name=` (the bytes, moved here from
  `http.ts` unchanged), `POST …/attach-locate/<doc>`,
  `POST …/attach-move/<doc>`, `POST …/attach-undo`. The document's path
  picks the directory through `attachmentDestination`, and a path outside
  the notebook is refused the way the content routes refuse it. The app can
  be told where to look (`keep`), which is how tests keep Spotlight out.
- Client: `theme/client/frontmatter/attach.tsx` (the pad, the dialog, the
  note), `model.ts` `addAttachment` / `removeAttachment` (the `{ file }`
  list in the document's own shape, entries already there kept as written),
  and `useFrontmatter.update`, so files added one after another each see the
  list the last one wrote rather than the one the page rendered.

## Verified

2026-09-02. Unit: `attachments/routes_test.ts` (5: the list is the
directory, empty until something lands; a day document's file moves into the
day's attachments and undo puts it back; another document's into the mirror
of its directory; a forged move, a document outside the configured
directories, a look without facts and an undo of nothing are each refused;
the bytes land as a copy), `day/files_test.ts` (11, the same answers on the
shared keeper), `frontmatter/model_test.ts` (+1: the list gains and loses a
`{ file }` entry in the document's shape, with or without the key, with or
without a block). The whole unit suite and `dev:check` green.

E2E, `http-wysiwyg-rail-e2e_test.ts`: over a day holding one file the
document does not list, the dialog shows it unticked; a file chosen from the
stand-in Downloads folder moves out of it into the day's attachments and is
listed with "Moved “deck.pdf” here from Downloads" and Undo offered; the
dialog then shows the moved file marked listed; ticking the other and Add
lists it ("Listed “chart.png”"); bytes from nowhere land as a copy ("Kept a
copy of “notes.txt” here"); Remove takes the moved one off the list while
its file stays. The rail and attach suites green (8), headless in Brave.
