---
created: 2026-09-05
updated: 2026-09-05
---

# The day's files get a page

A day's attachments directory could be seen in one place: the picker a
note's rail opens for "choose files…", which lists what sits beside the
note so a name can be ticked onto its `attachments:` list. Nothing browsed
the directory for its own sake, nothing showed the folders some days hold
(photo sets, a deck's exports), and the route that sends a file to the
Trash had no button since the rail's pad lists nothing. Meanwhile a day of
captures runs to forty files and hundreds of megabytes — data dumps, Slack
pictures, transcripts — and pruning them meant the Finder.

Today the directory is a page: `/<ymd>/files`, titled by a crumb, the day's
name then `File Attachments`. It was drawn first as a canvas and chosen
over a modal for the reasons a file browser is a destination everywhere
else: folders need a crumb and a back step, the names need the width, and
organising into folders — the next thing — wants a surface you stand on.

## What is on it

One row per folder, then one per file: the kind as a small chip, the name,
the note that lists the file (a link — this is the one thing the Finder
cannot show), and the size. A folder row opens the folder in place and
the crumb deepens; a file opens in a new tab through the day's own file
route, so a PDF or an image shows and anything else downloads. Above the
rows, what the page holds, the folders' bytes counted in.

The header holds one button, Show in Finder, because the Finder is where a
person goes when the page is not enough — to drag files elsewhere, or to
look at what a folder holds in ways a list cannot show. It opens the folder
the page shows.

Deleting is the day's own gesture. The × sits right after the name and
shows when the pointer rests on the row; on a phone the row swipes left,
the same swipe a day's item has. A file goes to the Mac's Trash; a folder
goes whole. The row folds, and the toast at the foot says what went and
holds Undo for eight seconds — the Trash and Undo are the safety, so there
is no dialog asking twice. Select turns the rows into checkboxes for the
six-dump case, and one toast then holds Undo for all of them.

## What changed underneath

The listing route learned folders and depth: `GET /day/:ymd/files?dir=`
lists a folder inside the day, with each folder's files and bytes counted
all the way down, and `GET /day/:ymd/files/*` serves a file by its path.
`POST …/remove` takes a path, a folder as readily as a file, and answers
with a move the existing undo route reverses — the keeper that already
remembered a drop's move off the desktop now remembers a move into the
Trash the same way. Every path is clean segments only; there is no way up
and nothing hidden.

The marks come from the day's notes: the routes are handed the notebook's
time root and read each note's `attachments:`, so a file a meeting note
lists says so, and the loose ones say nothing. The explorer's document
answer now carries the day a note under `time/` belongs to, which is how a
note's rail knows where "All of the day's files…" goes.

## What did not change

The rail's pad still lists nothing and is still the way to keep a file;
its heading now counts what the day keeps and offers Browse. The picker is
unchanged. A note keeps its `attachments:` line when the file it names
goes to the Trash; unlisting is not this page's to do yet. The page keeps
nothing dropped on it and imports nothing.
