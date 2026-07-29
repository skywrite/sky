---
created: 2026-07-28
updated: 2026-07-28
---

# Notebook time and the notebook filesystem

Sky's file layout and its idea of "now" are the same design, seen from two angles. NBFS —
the notebook filesystem — decides where a thing goes based on *when* it happened, and
notebook time decides what "when" means. Get these two right and the rest of Sky is
bookkeeping.

Two claims to hold onto, because everything below follows from them:

- **The day is the unit.** Not the file, not the project. Everything a day produced lives
  in that day's directory, next to the day file.
- **A day is a stretch of your waking life, not a calendar square.** It starts when you say
  it starts and ends when you say it ends, and it can run past midnight.

## Path anatomy

```
~/Sky/time/2026/03/30-05/03-31/day.md
           │    │  │     │
           │    │  │     └─ day directory, MM-DD
           │    │  └─ week directory, first and last day numbers
           │    └─ month of the week's first day
           └─ year
```

Weeks run **Monday through Sunday** and are named by their first and last day numbers:
`30-05` is Mon Mar 30 through Sun Apr 5. The week directory is filed under the month its
**first day** falls in, so that week lives under `03/` even though most of it is April.

Day directories are named `MM-DD`, carrying their own month. That's what makes cross-month
spillover self-describing:

```
time/2026/03/30-05/
  _tracking/          # week-level tracking CSVs
  03-30/  day.md      # Mon
  03-31/  day.md      # Tue
  04-01/  day.md      # Wed — April, still in March's week directory
  04-02/  day.md
  04-03/  day.md
  04-04/  day.md
  04-05/  day.md      # Sun
```

Because the day directory names its own month, they sort chronologically inside the week
with no special marker, and any path can be turned back into a date without consulting a
calendar. That's `parseDateFromDayPath()`, and the document store, the GraphQL resolvers,
and `ai:chat` all depend on it.

## Inside a day directory

```
03-31/
  day.md                       # the day itself
  journal/
    gratitude.md               # one file per journal type
  actions/
    meetings/                  # sky meeting:new
    messages/                  # sky message:new, slack:new, email
    notes/                     # sky notes:new
    ai-chats/                  # saved sky ai:chat conversations
```

Commands write into these paths through `DayDirFileWriter`, which resolves the day
directory, creates parents as needed, and de-duplicates a colliding filename by appending
`-2`, `-3`, and so on. It returns the path *relative to the day directory* — which is
exactly the form the day file's Complete list links with:

```markdown
- 14:00 > Roadmap sync -> [Atlas sync — Q2 roadmap](actions/meetings/atlas-sync-q2-roadmap.md)
```

Relative links mean a day directory is self-contained. Move it, archive it, hand it to
someone — the links still resolve.

## Weeks are created ahead of time

`sky week:new` materializes an entire week at once: seven `day.md` files pre-built with
their empty section skeletons and the current active streaks already stamped, plus
`_tracking/health/*.csv` copied from `src/tmpl/`. It refuses to run if the week directory
already exists — pass an explicit date to target a specific week.

Pre-creating matters because it means you can write into a future day — move a todo to next
Thursday, schedule a reminder — without anything having to invent a directory first.

## Attachments are filed differently — on purpose

Attachments do **not** follow the week structure. They live under `userDataDir` in a flat
date path:

```
~/Sky-Data/attachments/2026/03/31/
```

The notebook is meant to be a clean, diffable git repository at human scale. Binaries in it
would make every clone drag years of screenshots. The split is the reason the notebook
stays cheap to version. `dayAttachmentsDir()` builds these paths; `sky day:attachments:check`
finds attachments nothing references anymore.

## Notebook time

### "Now" is the active day, not the clock day

`fetchNow()` doesn't ask the system what day it is. It reads today's day file, and if that
day was never started, it walks backwards until it finds one that was. The most recent
**started** day is the active day, and that's what "now" means.

If you started Monday and never ran `day:end`, then at 1:30 AM Tuesday, notebook now is
**Monday at 25:30** — not Tuesday at 01:30. Your late-night work files under the day you
were actually living.

The hour is computed as `daysBack * 24 + clockHour`, so a day left open across two nights
reports `49:30` rather than silently rolling over. There's a 365-day safety limit on the
walk-back, so an empty notebook fails loudly instead of looping.

### Extended and negative hours

Times in the notebook are not clamped to `00:00`–`23:59`. The parser accepts any two-digit
hour, and `.normalize()` converts to a calendar date-time when you need one:

```
2026-03-31 25:30  →  normalize()  →  2026-04-01 01:30
```

Negative hours work too, and mean what arithmetic says rather than what you might guess:
`-7:56` is *seven hours and fifty-six minutes before midnight*, i.e. `16:04` the previous
day — not `17:56`. This falls out of `addHours()` producing signed values, and it's the
reason time math around day boundaries doesn't drift.

Conversions that cross a day boundary deliberately **keep** the extended form rather than
normalizing. Normalizing would refile the entry into the next day, which is precisely what
notebook time exists to prevent.

### `ended` is a duration, not a clock time

```yaml
started: 08:30
ended: 12h
```

`day:end` records how long the day was, not when it stopped. A seventeen-hour day is a real
thing that happened; "ended at 01:30" throws that information away and implies a date the
day didn't belong to.

### Timezones are per day

Each day file carries its own `tz:`. It's set at `day:start` and can be corrected with
`sky day:timezone`. When you travel, past days keep the zone you actually lived them in, so
a meeting at `09:00` three time zones ago still reads `09:00`.

- `dayTimezone(date)` — the zone for a given day, falling back to the current notebook
  timezone when that day has no file
- `convertToNotebookTimezone(when)` — take an outside timestamp (an email header, a
  calendar event) and express it as wall-clock time in the day's zone. It's deliberately
  liberal: unparseable input warns and falls back to notebook now rather than throwing, and
  a bad `tz:` keeps the system wall clock
- `sky util:timezone` reads the system zone; `sky util:now` prints notebook now;
  `sky util:tz:convert` does natural-language conversions

## Date types — never JS `Date`

| Type | Use for |
|---|---|
| `PlainDate` | A date with no time — counting days, comparisons, directory paths |
| `PlainDateTime` | Date + time with no zone — where extended hours live |
| `ZonedDateTime` | Date + time + zone — an actual instant |

All from `#universal/dates/nbdt/mod.ts`. JS `Date` silently mixes local and UTC and shifts
by a day at zone boundaries, which in a notebook keyed by date means work filed under the
wrong day. `bun run dev:lint` fails the build on `new Date()`, `.toISOString()` and
friends. Convert at the boundary when a third-party library hands you one.

## How commands accept dates

Most day-taking commands use the shared `dayArg()` / `dayFlag()` params, which accept
progressively shorter forms and default to today:

```bash
sky day:open 2026-03-31    # full date
sky day:open 3-31          # month and day, current year
sky day:open 31            # day, current month and year
sky day:open               # today
```

Some commands use the no-future variants, which reject a date ahead of today — useful where
backfilling is meaningful and forward-dating isn't.

`--when` flags take a date-time. Two variants exist: one defaulting to system time, one to
notebook time (`whenNBTime()`), which is what you want on anything that files into a day.

## Referring to another day

Documents that chain — a message thread continued across days — carry a `previous:` field
whose precision scales with distance. Same month gets `DD`, same year gets `MM-DD`,
anything older gets the full `YYYY-MM-DD`, each followed by the path below the day
directory. `computePreviousRef()` builds these. Short refs stay readable for the common
case without becoming ambiguous for the rare one.

## The API

Everything from `#shared/nbfs/mod.ts`:

| Function | Returns |
|---|---|
| `weekDir(date)` | `2026/03/30-05` |
| `dayDir(date)` | `2026/03/30-05/03-31` |
| `dayFile(date)` | `2026/03/30-05/03-31/day.md` |
| `dayAttachmentsDir(date)` | `2026/03/31` |
| `parseDateFromDayPath(path)` | `PlainDate` — the inverse of `dayFile` |
| `readDay(date)` / `writeDay(doc)` | A `DayDocument`, and back to disk |
| `fetchNow()` / `fetchNowSync()` | `ZonedDateTime` in notebook time |
| `dayTimezone(date)` | IANA zone string for that day |
| `convertToNotebookTimezone(when)` | `PlainDateTime` in the day's zone |
| `normalizeToPlainDate(input)` | `PlainDate` from a `PlainDate` or `YYYY-MM-DD` string |
| `computePreviousRef(path, date)` | A relative day reference |

Paths are relative to `DIR_TIME` (`<notebook>/time`), so every one of these takes an
optional `timeDir` — which is how the test suite runs against fixtures instead of your real
notebook.

## Format versions

| Version | Day path | Status |
|---|---|---|
| v1 | `2026/03/30-05/31/`, cross-month as `x01` | Retired |
| **v1.1** | `2026/03/30-05/03-31/` | **Current** — what everything reads and writes |
| v2 | `2026/04/W14/03.31/` | Deferred — see below |

**v1 → v1.1** replaced `DD` day directories and the `x` prefix for cross-month spillover
with `MM-DD`. The `x` marker sorted correctly but wasn't self-describing: you needed the
week directory to know what month `x01` meant. `sky nbfs:migrate` handles v1 notebooks.

**v2** is designed but not adopted. It numbers weeks `W00`–`W53` and files each week under
the month of its **Thursday** (the ISO rule), with `W00` and `W53` as overflow buckets for
year boundaries. That fixes the one thing v1.1 is genuinely awkward about: a week spanning
two months is filed under whichever month it *started* in, so under v1.1 the Mar 30 – Apr 5
week sits entirely under `03/` even though five of its seven days are April. Under v2 the
same week goes under `04/`, because its Thursday is April 2.

Do not migrate to v2 yet. `sky nbfs:migrate` will move the files — it is dry-run by default
and needs `--execute` — but only `readDay()` understands v2 paths, and it falls back to
them. Writes always go to v1.1, and `parseDateFromDayPath()`, which the document store and
GraphQL layer depend on, only parses v1.1. A migrated notebook would read back but write
into a second parallel tree.

## See also

- [Overview](overview.md) — the day file's contents, and the rest of the notebook
- [Architecture](architecture.md) — where this code lives and how it's used
