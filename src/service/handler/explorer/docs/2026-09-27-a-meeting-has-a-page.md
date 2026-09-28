---
created: 2026-09-27
updated: 2026-09-27
---

# A meeting has a page

Until today a meeting write-up was only a file: it opened in the explorer
with a filename in the header, three frontmatter chips, the markdown, and
the rail. The ask was an actually good meeting view, with three rulings:
keep the document exactly as it is, keep the clean look of the person and
organization pages, and keep the explorer what it is — a file, as written.
Previous meetings matter; nothing else was to be over-engineered.

## Where the page lives

`/<day>/meetings/<slug>`, where the slug is the file's name without `.md`:
`/2026-08-18/meetings/14-00_Zoom_Jane-Doe_Atlas-Launch`. The address
names the day the meeting belongs to and the file under it, the way
`/<day>/files` names a day's attachments. The day page's Meetings block,
the day rail's "filed" link, search results, and the page's own Previous
and Next links all go there. The explorer is unchanged: the same file at
`/explorer/<path>` is the markdown as written, with the rail it always
had. A typed view never replaces the file's own view; it gets a route.

## What the page shows

Above the document: the day as the way back, a circle of initials, the
meeting's title, and one line, "With Jane Doe, Tuesday Aug 18 at 14:00,
30 minutes on Zoom", with the person linked to their profile. The
document follows, without its own title line and without its Time/Date
and Attendees sections, since the header and the column already say
that. Beside it, in the person page's vocabulary:

- **Who**, each attendee as a profile link with their organization and
  which meeting this is, "2nd meeting, first met Jul 7".
- **When**, the day and time, then the length and the medium.
- **About**, what the file is filed under: people, organizations, a
  project, each a link.
- **Previous meetings**, four at most, newest first, and **Next**.
- **Files** and **Tags**, from the frontmatter as the rail shows them.
- Any card an extension adds to a file, through the `FileCard` slot, and
  any action, through `FileAction`, in the header.

**Edit** opens the file in the explorer with the editor already on
(`/explorer/<path>?edit`); the ⋯ menu's **Open in Explorer** opens it to
read. The page reads the file and never writes it.

## How the thread is chosen

Every meeting in the notebook that names one of this meeting's references
is a candidate: the attendees, the people and organizations it is filed
under, and each attendee's own organization. A candidate scores by how
much it shares, attendees counting double, so a meeting with the same
person outranks one that merely names the same organization. The four
best before this day are shown, newest first; the best after it is Next.
The people index and the backlinks the vocabulary already keeps are the
only sources, so the page says what the person's page would say about the
same files.

## The route

`GET /explorer/_api/meeting?day=YYYY-MM-DD&slug=<name>` (or `?path=`)
answers the view: who, when, about, previous, next, tags, and the file's
path, which the page then reads through `/explorer/_api/doc`. A slug with
a slash or a leading dot is refused (400); a day with no such meeting is
404; before the index is built, 503.

## Verified

- Unit: `bun test service/handler/explorer/meeting_test.ts
  service/handler/theme/client/meetingPage_test.ts service/handler/search`
  — the address from a path in either time layout, the route parsed back,
  the title, time and attendee readings, the thread's scoring and order
  with links to the page, the trimmed body, search results linking there.
- Live: the route answered a real meeting by day and slug with links to
  the page for its thread; a bad slug was refused and a missing one 404;
  search results for that meeting pointed at the page; the page rendered
  the header, the column and the extension card with no browser errors;
  the same file in the explorer showed its markdown unchanged.
