# The day's files

A day keeps files the way the desktop sweep does: in its attachments
directory, `attachments/YYYY/MM/DD/` under the user-data directory. The
directory is the record. Nothing is written into the notebook for a file
that is only kept, so the day file and notebook git stay as they were.

## What a person sees

- **The Files button** in the day's header opens the Files panel at the top
  of the day: a drop pad, then the directory as it is — time, kind chip,
  name, size, Remove. The panel also opens by itself while files are dragged
  over the page, so the pad is always there to aim at.
- **Drop on the pad and it moves.** No dialog, no question. The original
  keeps its name; the toast says "Moved report.pdf to today from Downloads"
  and holds Undo for eight seconds. Several files at once move together and
  Undo reverses all of them. A file with no original on this Mac lands as a
  copy, with progress shown in the pad.
- **Drop anywhere else and it is an import.** The import dialog opens (see
  `../../import/docs/README.md`): a transcript or a recording goes to its
  door, and a file no door takes is refused there and leaves with Remove.
  A recording over the transcription cap is refused before it uploads. The
  dialog never keeps; the pad does.
- **Remove** sends a file to the Trash.
- **On the phone** the paperclip is the import's picker; the pad is a desk
  thing, so a phone has no way to keep a file yet.

## Why a look, then a move

A browser drop carries a File with a name, a size, a type and a modified
time, and nothing else. No path, in Chromium, Safari or Firefox alike; that
is deliberate. But sky's service runs on the same Mac, and those three facts
identify the original: the modified time matches to the millisecond. So the
page posts them first (`POST /day/:ymd/files/locate`), the service checks the
Desktop and Downloads, then asks Spotlight for the name anywhere else, and
answers with the one file matching all three. Found, `POST …/move` renames it
into the day — instant, no upload, and the original is gone from Downloads
the way a person expects a move to work. Not found, the bytes go up
(`PUT …/files?name=`) and a copy lands, deduplicated by content like every
other attachment.

Only a located file ever moves: the move quotes the look's token, and the
service re-checks size and modified time before renaming. A file that
changed since the look is refused.

## Routes

All under `/day/:ymd/files`, mounted by `createDayRoutes` when a user-data
directory is given.

| Route | Does |
| --- | --- |
| `GET` | The list: name, size, modified, kind |
| `GET /:name` | The bytes, inline, by a clean name only |
| `PUT ?name=` | Store uploaded bytes as a copy |
| `POST /locate` | `{name, size, lastModified}` → `{token, match, ambiguous, already}` |
| `POST /move` | `{token, path, name}` → moves the located file in |
| `POST /undo` | `{moveId}` → the file goes back where it came from |
| `POST /remove` | `{name}` → into the Trash |

`files.ts` holds the routes. The look, the move, the undo and the directory
listing live in `../attachments/keep.ts`, shared with a document's
attachments — a file added from the explorer's rail lands the same way beside
its document; and `#lib/sys/locateFile.ts` holds the look itself. Tests run
against temp folders with Spotlight off.
