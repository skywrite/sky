---
created: 2026-09-03
updated: 2026-09-03
---

# The day's items, the day's rail, and the day's files

Design notes for `src/service/handler/day/` and the page that drives it,
`theme/client/day.tsx` with `dayRail.tsx`.

## The day's items

The plan on the page — Most important, Commitments, To-dos, Reminders — is
the day file's own lists, read by heading (`record.ts`). Each row writes
back to the file through `item.ts`, and every write answers with the fresh
view so the page shows what the file now says. The edits are the Day
model's, beside `isItemDone`: one line changes, every other byte stays.

- **The checkbox** strikes the item in the file (`~~task~~`, or for a timed
  item `HH:MM > ~~task~~`, the time kept readable) and un-strikes it from
  Done today. A checked to-do or commitment slides into Done today; a
  checked reminder just leaves.
- **The ×**, right after the item's text and shown when the pointer rests
  on the row, takes the item out of the file. On a phone, where nothing hovers, the row swipes left instead:
  a short pull bares Delete and holds it until it is tapped or anything
  else is touched; a long pull deletes on release. The row folds shut
  without a strike. When the item was its list's last, a bare `-` stays
  under the heading — the template's own spelling for an empty list — so
  the heading stays a list and the next write into it lands there.
- **Undo** follows either, in the pill at the foot, for eight seconds. An
  un-check restores the line; a restore after a delete puts the line back
  at the place the delete reported, byte for byte when the list has not
  moved since.

| Route | Does |
| --- | --- |
| `POST /day/:ymd/item` | `{list, raw, done}` → strike or un-strike, answers the view |
| `POST /day/:ymd/item/delete` | `{list, raw}` → the line leaves, answers `{at, view}` |
| `POST /day/:ymd/item/restore` | `{list, raw, at}` → the line returns at `at`, answers the view |

A miss — the day changed under the page — is a 404 and writes nothing.
The swipe itself is `theme/client/swipe.ts`: horizontal only, so a touch
that moves more up or down than sideways stays the page's scroll.

Narrative: [2026-09-03 — an item can leave the day](2026-09-03-an-item-can-leave-the-day.md).

## The rail

A day has the Details rail a document has (`theme/client/rail.ts` holds the
one rule for opening it: a third column on a wide window, remembered; an
overlay from the header's Details button below 1180px). Its body scrolls;
its foot is anchored.

- **Schedule** — the calendar's meetings for the day, from the same read the
  meeting check makes (`schedule.ts`, `GET /day/:ymd/schedule`). Each row
  stands against the notebook clock: a past meeting says `filed`, linking
  the record the notebook has of it, or `no record`; the one under way is
  tinted and offers `join` when the event has a conference link; a coming
  one shows its length. The record match is the meeting check's own rule,
  a notebook meeting starting within fifteen minutes of the calendar's
  start. Re-read every minute. A calendar that does not answer reads as
  "Calendar not read", never as an empty day.
- **Chats** — the chats filed under the day, with time and turn count, and
  the live threads that started on it, marked with a dot.
- **Working** — import jobs in hand: running, waiting for the person, or
  stopped where a start could pick them up, with Review or Open. A filed
  import is on the day already and leaves the rail; a file sky refused was
  never work and never shows. The sidebar lists neither threads nor
  imports; the rail is where a day's chats and work show.
- **File Attachments** — the drop pad, anchored at the foot, and nothing
  else; the day's directory is the explorer's to show.

## The day's files

A day keeps files the way the desktop sweep does: in its attachments
directory, `attachments/YYYY/MM/DD/` under the user-data directory. The
directory is the record. Nothing is written into the notebook for a file
that is only kept, so the day file and notebook git stay as they were.

### What a person sees

- **The pad** at the foot of the rail takes a drop, or a pick through
  "choose files…". It is the only place a file is kept as it is: a drag
  over the page never opens anything, so a drop lands where the person
  aimed it.
- **Drop on the pad and it moves.** No dialog, no question. The original
  keeps its name; the toast says "Moved report.pdf to today from Downloads"
  and holds Undo for eight seconds. Several files at once move together and
  Undo reverses all of them. A file with no original on this Mac lands as a
  copy, with progress shown in the pad.
- **Drop anywhere else and it is an import** — the page, and the rail's
  other sections too; only the pad keeps. The import dialog opens (see
  `../../import/docs/README.md`): a transcript, a recording or a screenshot
  of a conversation goes to its door, and a file no door takes is refused
  there and leaves with Remove. A recording over the transcription cap, or
  a screenshot over the vision model's, is refused before it uploads. The
  dialog never keeps; the pad does.
- **Remove** (`POST …/remove`) sends a file to the Trash; the page offers
  no button for it since the pad lists nothing.
- **On the phone** the paperclip is the import's picker; the pad is a desk
  thing, so a phone has no way to keep a file yet.

### Why a look, then a move

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

### Routes

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
