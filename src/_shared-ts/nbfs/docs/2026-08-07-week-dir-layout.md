---
status: ratified
created: 2026-08-07
updated: 2026-08-30
---

# The week directory is the last level that isn't self-describing

## Outcome (2026-08-30)

Shipped as `time/YYYY/W##/MM-DD/`, the default layout since 2026-08-30, after two more
rungs than this document walked:

| Rung | Why it moved on |
|---|---|
| `YYYY/W##-MM/MM-DD` (chosen below) | The month suffix trails the number, so a year listing still sorts by week and the label buys little at a glance. |
| `YYYY/MM-W##/MM-DD` | Month first, so a year listing groups by month — but the label is derived data on every path. |
| **`YYYY/W##/MM-DD`** | Chosen. Zero redundancy. The month-labeled form stays available. |
| Configurable patterns | The layout became a config value, `nbfs.layout`, whose value is the pattern string itself. v1.1 stays selectable, every layout stays parseable through `toTimeRef`, and a later relabel is one config line plus `nbfs:migrate`. |

The open questions below resolved in the build: a split week's `_tracking/` and other
week-level files live in the week's first in-year bucket (`week:new` writes there;
`week:plan`, `week:checkin`, and `summary:week` read there), and the year clip already
held at `week:new` time. `nbfs:migrate` keys on day directories rather than day files —
see `src/commands/all/nbfs/docs/`. The reference notebook moved in one rename-only commit.

The rest of this document is the reasoning as written on 2026-08-07.

**Decision:** the next layout is `time/YYYY/W##-MM/MM-DD/`. The month directory goes
away, the week directory becomes an ISO week number suffixed with the month its first
day falls in, and the day directory does not change.

```
time/2026/W30-07/07-24/day.md
          │      └─ day, MM-DD — unchanged from v1.1
          └─ ISO week 30, which starts in month 07
```

## What started it: does the layout affect what the model sees?

It does not, and this is worth recording because it is the obvious reason to migrate
and it is wrong.

Every dated document in `ai:chat`'s context already arrives with its date resolved,
stamped ahead of the path:

```
<!-- START FILE -->
<!-- 2026-07-24 Fri (2 days ago) | time/2026/07/20-26/07-24/actions/meetings/atlas-sync.md -->
```

`ChatContext/dayLabel.ts` builds that label from `parseDateFromDayPath`, and
`ChatContext/mod.ts:607` applies it to the assembler output — which is the only
notebook-content surface in the chat prompt, so every dated document in every turn
carries it, including ones the model pulls in mid-conversation. The label also carries
the weekday and a `TODAY`/`yesterday`/`N days ago` anchor, which no directory name can.

Retrieval is likewise layout-blind: GraphQL filters on the typed `date`, resolved
through `parseDateFromDayPath`, and no `ai:chat` tool takes a notebook path as a
parameter. The model never has to construct or parse one.

Two callers do render context with raw paths and no label — `summary/day.ts:161,165`
and `ai/context/gather.ts:141`. That is a three-line fix and it is independent of
everything below. **If model comprehension is ever the argument for changing the
layout, it is already answered; fix those two call sites instead.**

## What is actually wrong with v1.1

### The week directory has the defect v1.1 fixed one level down

v1.1 (`eebcf83`) renamed day directories from `DD` to `MM-DD` because a bare `DD` is
only meaningful given its parent, and lies outright at cross-month boundaries — hence
the `x` prefix it retired. The week directory has the same defect and did not get the
same fix:

```
2026/07/27-02/08-01/     the week is Jul 27 – Aug 2; the "02" is August, under a parent that says 07
```

Worse, `DD-DD` and `MM-DD` share a shape, so adjacent segments in one path use the same
syntax for different grammars. `2026/07/04-10/07-04/` invites reading the week range as
"April 10". `dayLabel.ts` says as much in its own docstring: the week-range segment
invites a misread.

### The month directory is unread, and it has to lie

There is no `monthDir()`, no `summary:month`, no month-level artifact. Nothing in the
tree reads or writes a month directory — it contains week directories and nothing else,
and the scanner walks recursively without caring about depth (`service/scanner/walkDirs.ts:53`).

It is also structurally arbitrary. Twelve months do not tile into fifty-two weeks, so
every week that spans a month boundary needs a tiebreak, and each rule misfiles
differently — v1.1 files by the week's first day, so `2026/03/30-05/` holds five April
days; the superseded month-nesting proposal filed by Thursday, which still puts three
March days under `04/`. That is roughly twelve collisions a year, paid for a container
nothing reads.

The year boundary costs one collision a year by comparison, and only when Jan 1 isn't a
Monday. Nesting weeks under years pays the cheap boundary; nesting them under months
pays the expensive one twelve times over.

### Weeks are the unit the system already runs on

`week:new` materializes seven days at once. `_tracking/health/*.csv` is per-week.
`summary:week` synthesizes seven daily summaries. None of that has a month analogue.

## Why `W##-MM` and not the alternatives

The ladder, in the order it was walked, with why each rung failed:

| Candidate | Rejected because |
|---|---|
| `YYYY/MM/W##/MM.DD` | The superseded month-nesting proposal. Keeps the arbitrary month container and a fourth level, and needs the Thursday rule. |
| `YYYY/W##/YYYY-MM-DD` | Named as deferred in `eebcf83`. Full-date day dirs are redundant — the year is ambient in the path — and they fix the segment that isn't broken, leaving the ambiguous week range in place. |
| `YYYY/W##_MM-DD` | `_` is not a directory convention here; it already means "not a day" (`_tracking/`). And the Monday is fully derivable from `W##` + year. |
| `YYYY/MM-DD/MM-DD` (week named by its Monday, no `W##`) | Drops the ISO machinery entirely, but puts two same-shaped `MM-DD` segments side by side — the original collision, reintroduced. Also loses the honest name for the year-boundary orphan that `W00`/`W53` provides. |
| `YYYY/W##-Jul20/MM-DD` | Month text kills the collision and scans well, but adds a `monthShort` accessor that doesn't exist and makes the time tree's first alphabetic segment. The day number is redundant with `W##`. |
| `YYYY/W##/MM-DD` | Cleanest and zero redundancy, but 53 opaque names under each year. Finding a period means computing week numbers. |
| **`YYYY/W##-MM/MM-DD`** | **Chosen.** Two characters of derived data buy back a scannable year listing. |

The suffix is defined as **the month of the week's first day** — a fact, not a tiebreak,
and the same rule v1.1's month directories already use. Because it is a label rather
than a container, no file's location depends on it: `W31-07` holds `08-01` and `08-02`,
and those day directories say so themselves.

The day directory stays `MM-DD` rather than moving to v2's `MM.DD`. The only argument
for the dot was that `MM-DD` looked like the `DD-DD` week range, and that range is gone.
Keeping the dash means day directories are not renamed at all — only their ancestors
move.

Properties worth keeping true if this is ever revised:

- Three segments, three distinct shapes. Nothing reads as anything else.
- Sorts chronologically. `W##` is fixed-width and leads, so the suffix never interferes.
  `W00-01` sorts first, `W53-12` last.
- Shorter than v1.1: `time/2026/W30-07/07-24/` against `time/2026/07/20-26/07-24/`.

## What does not change

- **Day directory names.** `parseDateFromDayPath`'s `^(\d{2})-(\d{2})$` is untouched;
  only its segment offset moves.
- **`previous:` refs.** `DD/`, `MM-DD/`, `YYYY-MM-DD/` are date-based, and
  `computePreviousRef.ts:22` slices the sub-path positionally.
- **Relative links inside day files.** They live below the day directory.
- **The year clip.** Weeks already clip at Dec 31, so a year's first week already starts
  on a non-Monday. `W00`/`W53` give those orphan days an honest name, which is the one
  thing the ISO numbering buys that a date-named week directory cannot.
- **Attachments.** They never followed the week structure.
- **Resume.** `ChatContext/resolveUniverse.ts` re-derives day directories from the date
  encoded in a stale path and already knows three historical schemes, so chats saved
  before a migration keep resolving.

## Sequencing

Three pieces, each shippable alone, in order:

1. **Label the unlabeled context surfaces** — `summary/day.ts:161,165` and
   `ai/context/gather.ts:141`. Independent of the layout; do it regardless.
2. **Land the layout in `v2/`, migrate nothing.** `v2/weekDir.ts` drops its
   `nbfsWeekMonth` call and emits `YYYY/W##-MM`; `nbfsWeekMonth.ts` and its tests are
   deleted; `nbfsWeekNumber.ts` is unchanged (`W00`/`W53` already implemented and
   tested); `v2/dayDir.ts` emits `MM-DD`; `v2/parseDateFromDayPath.ts` moves its day
   segment from `timeIndex+4` to `+3` and swaps dot for dash. Writes still go to v1.1.
   Fully reversible.
3. **Flip the writers and migrate.** Re-point `dayDir`/`weekDir`/`dayFile`/
   `parseDateFromDayPath` at v2, invert `readDay`'s fallback order, then `nbfs:migrate`
   dry-run → verify against a copy → `--execute`. `nbfs:migrate` computes targets
   through `weekDir`/`dayDir`, so it follows for free.

Before step 3: test on a copy, pause Tresorit sync during the move, keep it to one
rename-only commit in the notebook git, grep shell aliases and editor workspace files
for `/time/20`, and rebuild the VS Code extension (its providers import
`parseDateFromDayPath` rather than matching paths themselves, so they follow, but they
need reinstalling).

## Open

- Whether a split week's `_tracking/` belongs in the first or second directory, and what
  `week:new` does at a year boundary today. Equally true under v1.1 — whatever it does
  now would be inherited.
- `docs/nbfs.md`'s format-version table still describes v2 as `YYYY/MM/W##/MM.DD`. It
  needs updating whenever step 2 lands.
- There is no forcing function. Nothing is blocked on this, nothing degrades by waiting,
  and the migration's cost does not scale with the notebook's size.
