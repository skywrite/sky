---
created: 2026-09-03
updated: 2026-09-18
---

# The day's items, the day's rail, and the day's files

Stable activity references and two-way updates with ongoing work are implemented by `lib/workstreams/day.ts`; the complete model is described in the [workstream design](../../../../../docs/topics/workstreams/README.md).

Design notes for `src/service/handler/day/` and the page that drives it,
`theme/client/day.tsx` with `dayRail.tsx`.

The day view shows the plan and record. Conversations open on their own chat
pages; the day has no embedded chat composer. Add a file in the header
opens the import picker on desktop and mobile.

## The day's items

The plan on the page — Most important, Commitments, To-dos, Reminders — is
the day file's own lists, read by heading (`record.ts`). Each row writes
back to the file through `item.ts`, and every write answers with the fresh
view so the page shows what the file now says. Check, delete and restore use
the Day model's line edits, beside `isItemDone`. Completion then orders whole
task blocks within the list, preserving their notes, links and surrounding text.

Inline forms add to-dos, reminders, and commitments, including when their
sections are empty. A time makes a task a commitment; times accept the
notebook's extended hours. Adding requires an existing, open day file.

Each row's "Get Sky's help" opens a temporary chat with the item, its notes
and links, and its source drafted in the composer (`dayItemHelp.tsx`).
Nothing is sent. The person tunes the thread or edits the request first,
then sends, or discards it. See the chat notes,
[2026-09-13](../../chat/docs/2026-09-13-discard-what-was-never-sent.md).

Task text edits in place by double-click on desktop or a tap on touch screens;
links retain their normal navigation. Details opens the same draft in a dialog
or a mobile bottom sheet for text, type, category, time and date. Moving from inline
editing into Details does not save. Save commits; Cancel discards. Refreshes
preserve drafts, including when a changed or ended day prevents saving.

`editing.ts` addresses the exact task heading and first line, refusing ambiguous
or stale matches. `editingText.ts` edits or moves its entire Markdown block so
notes and nested items travel with it; text fields retain inline Markdown and
reference definitions stay in the file. The day label reads only the first line,
while `raw` retains attached notes. Destination bullet markers must match to
avoid accidentally splitting one Markdown list into two. Edit retries use an
operation ID; Undo preserves unrelated later changes and refuses to overwrite
changed task blocks. Linked workstream activities open their canonical details.

**Organize** combines manual ordering and selection across the plan lists. A row
selects for moving; its grip reorders within the same Markdown list and category.
Desktop grips also appear on hover or keyboard focus outside Organize. Touch
grips appear only in Organize so normal scrolling, text editing and swipe deletion
retain their gestures. Grip arrow keys offer the same ordering without dragging.
Selection circles replace completion controls while organizing.

A dragged row travels whole. The grip lifts a copy of the entire row, with its
control, its time and its text as wrapped, and the copy stays under the pointer
or the finger. The row itself waits in the list as an empty slot. Rows step
aside as the copy passes, so the slot always shows where the row will land.
On release the copy glides into the slot, and then the saved list takes its
place. Escape, or a cancelled touch, puts the row back and saves nothing.
See [2026-09-18 — a dragged row travels whole](2026-09-18-a-dragged-row-travels-whole.md).

Order is the order of complete Markdown blocks, never a separate collection of
task IDs. The day frontmatter's `manual-order` list names headings whose explicit
order completion and editing must preserve. Commitments use a day-wide
`commitments-order: manual` preference, with time order as the default. Switching
back to Time sorts the file; dragging never changes a time. This preference must
be honored by additions as well as rendering, or a later write would silently
erase a user's order.

`organizing.ts` moves whole blocks between days. It validates all selections and
the destination before writing, creates a missing destination from the normal
future-day template without starting it, writes that destination first, and then
removes the source blocks. It resolves references and rebases relative links,
including links in notes. A revision covers both the block and its resolved
references, so a stale selection cannot move newly changed notes or links.
Duplicate destinations and ended days reject the entire batch. Linked workstream
activities retain their canonical scheduling flow instead of bypassing their
participation history through a raw Markdown move.

Moves, reorders and editor saves with a changed date share operation IDs and Undo.
An unchanged pair of files restores exactly; an untouched destination created by
the move can be removed. With later edits, Undo reverses only the affected blocks
and refuses changed blocks, references or ordering preferences. Destination-first
writes and rollback of only the operation's own bytes avoid losing source items
when a multi-file write fails. These operations use the shared planning lock and,
when workstreams are enabled, each affected day's projection lock.

A move can create a partial week. `week:new` and the week's **Create remaining
days** action therefore fill missing canonical day files without overwriting
existing plans or creating `day-2.md`. Day start reconciles streaks on an existing
future day. Do not run day-start routines merely to schedule an item.

**From next lists** moves unfinished, untimed items from `next-professional.md`
and `next-personal.md` into To-dos or Reminders. Category follows the source.
Schedule files stay with the existing day-start flow. `planning.ts` checks
selected items again, resolves reference links and rebases relative links for
the day file. It writes the destination first and rolls back failed writes
only while its own bytes still match. These moves share a local lock across
days because their Next sources are shared. Undo lasts eight seconds in the
UI, with a short-lived server token; it restores original bytes when unchanged,
otherwise reverses only those items and preserves unrelated edits. Changed
items or source references require reviewing the files instead of overwriting
them. Request IDs make retries of a successful save idempotent.

The day file's nonempty `ended` marker makes its task lists read-only, including Done today,
deletion and Undo. A padlock with **Ended** appears beside the task count. Item
routes recheck the file before a write and return 409 with the ended view to a
stale client. Calendar midnight alone does not close a day. Filed documents and
attachments can still be opened and added.

- **The checkbox** strikes a task in the file (`~~task~~`, or for a timed
  item `HH:MM > ~~task~~`, the time kept readable). Checked tasks remain in
  their original list and can be unchecked there. Unless manually ordered,
  they are grouped at the top.
  To-dos keep their relative order within the checked and unchecked groups,
  matching the VS Code extension's Cmd+Shift+C behavior. Commitments sort
  by time within each group. The view and file use the same ordering;
  additions and restores preserve it too. Done today shows entries from the
  separate Complete lists, without repeating checked plan items. The header's
  progress counts both. A checked reminder is deleted through the same action
  as Delete; its row collapses and the pill says "Reminder cleared".
- **Delete**, the × beside Details on desktop or the button inside the Details
  editor, takes the item out of the file. On a phone, the row can also swipe left:
  a short pull bares Delete and holds it until it is tapped or anything
  else is touched; a long pull deletes on release. The row folds shut
  without a strike. When the item was its list's last, a bare `-` stays
  under the heading — the template's own spelling for an empty list — so
  the heading stays a list and the next write into it lands there.
- **Undo** follows either, in the pill at the foot, for eight seconds. An
  un-check removes a task's strike; a restore after a delete or reminder
  completion puts the line back at the place the delete reported, byte
  for byte when the list has not moved since.

| Route | Does |
| --- | --- |
| `POST /day/:ymd/item/organize/move` | `{items: [{list, raw, revision}], date, requestId}` → move a selection to a date, answers `{view, undo, date}` |
| `POST /day/:ymd/item/organize/reorder` | `{list, items, requestId}` → save a complete, revision-checked list permutation |
| `POST /day/:ymd/item/organize/order` | `{order: "time" \| "manual", requestId}` → save the commitment ordering preference |
| `POST /day/:ymd/item/organize/undo` | `{id}` → reverse a move, reorder or ordering preference |
| `POST /day/:ymd/item/edit` | `{list, raw, text, revision?, kind?, category?, time?, date?, requestId}` → edit or move a task block, answers `{view, undo, undoRoute?, item, date?}` |
| `POST /day/:ymd/item/edit/undo` | `{id}` → undo an edit without overwriting later task changes |
| `POST /day/:ymd/item/add` | `{kind, text, category?, time?, requestId}` → add an item, answers `{view, undo, message}` |
| `GET /day/:ymd/item/next` | The current Next candidates, including already-on-day and unavailable rows |
| `POST /day/:ymd/item/pull` | `{kind, ids, requestId}` → move selected Next items, answers `{view, undo, message}` |
| `POST /day/:ymd/item/undo` | `{id}` → reverse an addition or move, answers the view |
| `POST /day/:ymd/item` | `{list, raw, done}` → strike or un-strike, answers the view |
| `POST /day/:ymd/item/delete` | `{list, raw}` → delete an item or complete a reminder, answers `{at, view}` |
| `POST /day/:ymd/item/restore` | `{list, raw, at}` → the line returns at `at`, answers the view |

A miss — the day changed under the page — is a 404 and writes nothing.

Workstream activities planned for a day appear as ordinary markdown links under
`Workstream Todos`, addressed by stable workstream and activity IDs. The current
open day projects the canonical activity's title and state; ended and past days retain their
recorded participation snapshot. A checkbox writes the canonical result before
the day projection. Repeated planning repairs an interrupted projection without
adding another task. Removing the row detaches its daily placement and keeps the
underlying activity; Undo reattaches it. Decisions open their canonical resolution
instead of treating a checkbox as a business decision. Promoted activities open
their sub-workstream. Broken references remain visible with a repair message.

Day item requests check their origin and serialize app writes with workstream
planning. Ordinary unlinked rows retain the raw-text operations described above.
The swipe itself is `theme/client/swipe.ts`: horizontal only, so a touch
that moves more up or down than sideways stays the page's scroll.

Narrative: [2026-09-03 — an item can leave the day](2026-09-03-an-item-can-leave-the-day.md).
Reminder completion: [2026-09-06 — completing a reminder deletes it](2026-09-06-completing-a-reminder-deletes-it.md).

Rows grow to fit wrapped text and collapse through a grid track, with no fixed
height cap. See [2026-09-05 — larger type without clipped tasks](2026-09-05-larger-type-without-clipped-tasks.md).

## Reflections and notes in the day's record

In the day's record, journal entries appear in **Reflections** and notes
appear in **Notes**, each with its own count. Empty sections stay hidden.
Both retain their document links and times. A reflection with a nonblank
`summary:` shows that text below its title, with line breaks preserved and
long text wrapping on narrow screens. Entries without summaries have no
summary placeholder. Summaries render as ordinary text so selections survive
unrelated renders and polling.

## Videos and chats in the day's record

The main column lists Videos and Chats in the day's record, including
when Details is closed. Video rows come from `actions/videos/`: their
saved summary names the recording, with its time, sender, recipients, and
platform. The row opens the notebook's video record and transcript.

The Chats block and the rail use one hierarchy (`theme/client/dayChats.ts`).
Each branch sits below its parent, at any depth, and says which turn it
left from. Counts on branches name only their **new turns**; shared turns
remain in the parent and are assembled when the chat opens. Saved titles
link directly to their notebook documents in Explorer. A separate **Continue
chat** action resumes the conversation. A live continuation replaces its
saved row while retaining that document link and the branches below it;
Continue chat reuses the active thread. Unsaved titles open their live
conversations and have no document action. Parent lookup uses the live id when it is
available and falls back to the saved path. A parent outside the day is
still named beside the branch point.

The chat store walks every level of the day's chat directory so further
splits remain visible. Returning to the day from a chat or document reads
the day again, bringing in newly filed videos and conversations. Changes
to the live chat list or import state also refresh the record while it is
open; the existing day stays visible during the read.

Narrative: [2026-09-06 — videos and chat branches in the day](2026-09-06-videos-and-chat-branches.md).

Document navigation: [2026-09-08 — saved chat titles open their documents](2026-09-08-saved-chat-document-links.md).

## The rail

A day has the Details rail a document has (`theme/client/rail.ts` holds the
one rule for opening it: a third column on a wide window, remembered; an
overlay below 1180px). It folds from the chevron in its top-left corner;
folded, the chevron waits at the header's end and brings it back. Its body
scrolls; its foot is anchored.

- **Meetings** — calendar events, saved meeting files, and inline meeting
  notes from the day's Complete lists (`DayDocument.meetings`). For example,
  `10:00 > Jane Doe Zoom -> discussed next steps` is a meeting record even
  without a linked file. Linked entries and their files merge by path.
  `schedule.ts` combines these with calendar events, matching each record
  at most once within fifteen minutes of the event start and retaining
  unmatched records. Rows sort by time; inline records link to the day and
  say `noted`, saved files say `filed`. Current calendar events still offer
  `join`. Local records remain visible if the calendar fails. The existing
  `GET /day/:ymd/schedule` route refreshes one minute after the previous request
  settles. Failed refreshes keep the last schedule visible with a stale warning
  and a link to Connections. See the [Keychain contract](../../../../lib/secrets/docs/README.md).
  Calendar attendees resolve by exact email against the current notebook
  contacts, ignoring address case. At a shared familiarity score of at least
  100, known people use their recorded short name, or the first word of their
  preferred `name:` entry; otherwise they use their full recorded name.
  [Person scoring](../../../scanner/docs/README.md#relevance-and-familiarity)
  combines direct contact with the family bonus and excludes mentions from
  familiarity. Explicit compound given names are kept; attendees with the
  same short name use their full recorded names. Scoped aliases such as
  `atlas/sam` are not display names. Unmatched or shared addresses retain
  the calendar's display name, falling back to the address. Names are never
  guessed from email handles. Contact and score edits are picked up on the
  next schedule refresh.
  A timed past meeting marked `no record` takes a transcript or recording
  drop: the row lights blue and opens the shared import dialog for that
  slot. The section heading and the blank space below its rows, before Chats, import an
  unscheduled meeting on the viewed day, with an editable suggested time;
  hovering there turns the whole section blue. See [the meeting import flow](../../import/docs/README.md#dropping-on-a-meeting).
- **Chats** — only live conversations from the main column's chat hierarchy,
  with a count of live chats, time, and current state. A branch names its parent
  and the turn it left from. Saved-only chats remain in the main column.
- **Working** — import jobs in hand: running, waiting for the person, or
  stopped where a start could pick them up, with Review or Open. A filed
  import is on the day already and leaves the rail; a file sky refused was
  never work and never shows. The sidebar lists neither threads nor
  imports; the rail is where a day's chats and work show.
- **File Attachments** — the drop pad, anchored at the foot, with the
  count of what the day keeps in its heading and Browse beside it. The pad
  lists nothing; Browse opens the day's files as a page (below).

## The day's files

A day keeps files the way the desktop sweep does: in its attachments
directory, `attachments/YYYY/MM/DD/` under the user-data directory. The
directory is the record. Nothing is written into the notebook for a file
that is only kept, so the day file and notebook git stay as they were.

### The page

`/<ymd>/files` is the directory as a page (`theme/client/dayFiles.tsx`),
titled by a crumb — `Thursday, September 3, 2026 › File Attachments` —
and reached from the rail's heading, or from a note's Files section
("All of the day's files…"). Folders come first, then files, one row each:
the kind, the name, the note that lists the file in its `attachments:`
(a link to it), the size. A folder row opens the folder in place and the
crumb deepens (`… › File Attachments › photos`); a file opens in a new
tab. The line above the rows says what the page holds — `13 files,
1 folder · 118 MB`, the folders' bytes counted in. The list re-reads every
few seconds while the tab shows, so a capture or a sweep lands without a
reload.

- **The ×** after a name, shown when the pointer rests on the row, sends
  the file — or the folder, whole — to the Mac's Trash. On a phone the row
  swipes left instead, the way a day's item does. The row folds, and the
  toast says `Moved “x” to the Trash` (`Moved “photos” and its 12 files to
  the Trash` for a folder) and holds Undo for eight seconds; Undo brings
  it back out of the Trash. There is no confirm: the Trash and Undo are the
  safety.
- **Select** turns the rows into checkboxes; `Move 5 to the Trash` sends
  them one after another, and one toast holds Undo for all of them.
- **A note that lists a file** keeps its `attachments:` line when the file
  goes; the note's rail then shows the name without a file behind it.
  Unlisting from the note is not done here.
- **Show in Finder**, in the header, opens the folder the page shows in
  the Finder — the day's own, made on the spot if the day has none yet.
- The rail's pad is still the way to keep a file; the page keeps nothing
  and imports nothing, so a drop on it does nothing.

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
- **Remove** (`POST …/remove`) sends a file or a folder to the Trash and
  answers with a move Undo can quote; the files page is where it is
  offered.
- **On the phone** Add a file in the header is the import's picker; the pad is a desk
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
| `GET [?dir=]` | The listing: `{path, label, folders: [{name, files, size, modified}], files: [{name, size, modified, kind, listedBy?}]}` — the day's, or one folder's |
| `GET /*` | The bytes, inline, by a clean path inside the day's files |
| `PUT ?name=` | Store uploaded bytes as a copy |
| `POST /locate` | `{name, size, lastModified}` → `{token, match, ambiguous, already}` |
| `POST /move` | `{token, path, name}` → moves the located file in |
| `POST /undo` | `{moveId}` → the file goes back where it came from — off the desktop, or out of the Trash |
| `POST /remove` | `{path}` → the file, or the folder whole, into the Trash → `{moveId, folder, files}` |
| `POST /reveal` | `{path}` → the Finder on the folder, or on the file selected in its folder |

A path inside the day's files is clean segments only (`cleanRelativePath`):
no way up, nothing hidden. The `listedBy` mark comes from reading the day's
notes for their `attachments:` (the routes are given the notebook's time
root for it; without one, nothing is marked).

The document attachment picker shares these marks; see the
[Explorer design](../../explorer/docs/README.md) for its grouping and selection rules.

`files.ts` holds the routes. The look, the move, the undo and the directory
listing live in `../attachments/keep.ts`, shared with a document's
attachments — a file added from the explorer's rail lands the same way beside
its document; and `#lib/sys/locateFile.ts` holds the look itself. Tests run
against temp folders with Spotlight off.
