---
created: 2026-07-28
updated: 2026-07-28
---

# Overview

How Sky is put together. Ten minutes here and nothing the CLI does will surprise you again.

## The core loop

```
Self-reflection → Learning → Action → Accountability
```

1. **Self-reflection** — daily journaling with AI-generated questions that adapt to the
   day in front of you: weekday vs. weekend, start of the month, what you wrote yesterday.
2. **Learning** — pull the insight out of what happened instead of letting it evaporate.
3. **Action** — turn reflections into concrete tasks and commitments that land in a file.
4. **Accountability** — track what you said you'd do against what you actually did.

Everything below exists to serve that loop. The file conventions are not bureaucracy; they
are what makes the loop legible to `grep`, to your editor, and to an AI reading the whole
notebook at once.

## Everything is a markdown file

Every document Sky creates is plaintext markdown with YAML frontmatter. Here's a meeting:

```markdown
---
who: Jane Doe, John Smith
when: 10:00 - 10:45
medium: Zoom
summary: Atlas sync — Q2 roadmap
created: 2026-03-31
rel:
  - Acme Corp
tags: Product/Roadmap
---

# Atlas sync — Q2 roadmap

Discussed the roadmap for Q2...
```

No proprietary format, no database, no lock-in. It's readable with `cat`, searchable with
`grep`, editable in any editor, diffable and version-controllable with git. Sky's whole
value proposition rests on the fact that if Sky disappeared tomorrow you'd still have every
word.

The frontmatter is the structure the tooling leans on. `rel:` links documents to orgs and
people, `tags:` builds a slash-hierarchy taxonomy, and `when:`/`created:` place a document
in time. Commands maintain these for you, but nothing stops you from typing them by hand.

## The day file

Your day is one markdown file that Sky manages:

```
~/Sky/time/2026/03/30-05/03-31/day.md
```

```markdown
---
started: 08:30
ended:
location: places/US/NY/New-York/Manhattan
tz: America/New_York
---

# **2026-03-31 - Tue**

## Most Important
- Ship Atlas v1

## Professional Commitments
- Send Jane the migration plan by EOD

## Personal Commitments
-

## Professional Todos
- Review John's PR
- Draft the Q2 roadmap doc

## Personal Todos
- Pick up groceries

## Reminders
- Renew passport this month

## Streaks
- ~~Morning run~~
- Read 20 pages — 12d

## Professional Complete
- 09:30 > Standup with the Atlas team
- 11:00 > Deploy staging build
- 14:00 > Roadmap sync -> [Atlas sync — Q2 roadmap](actions/meetings/atlas-sync-q2-roadmap.md)

## Personal Complete
- 18:15 > Gym
```

Frontmatter fields, always in this order:

| Field | Meaning |
|---|---|
| `started` | Time you began the day (`sky day:start`) |
| `ended` | Length of the day as a duration, e.g. `12h` — empty until `sky day:end` |
| `location` | Path into `places/`, e.g. `places/US/NY/New-York/Manhattan` |
| `tz` | IANA timezone the day was lived in |

Sections appear in a fixed order — Most Important → Commitments → Todos → Reminders →
Streaks → Complete. The category prefixes are `Professional` and `Personal`.

Two conventions worth knowing:

- **Complete items are timestamped, not checked off.** The format is `HH:MM > what you
  did`, optionally followed by `-> [Title](path)` linking to the document it produced.
  That's why the Complete list doubles as a timeline of the day.
- **Strikethrough means done in a list that isn't Complete.** `~~Morning run~~` in the
  Streaks list is a completion record and is never rewritten by tooling.

## Days follow sleep, not midnight

A day starts with `sky day:start`, ends with `sky day:end`, and is allowed to run past
midnight. Work at 1:30 AM belongs to the day you're still living, so Sky writes it as
`25:30` rather than orphaning it into a mostly-empty tomorrow. Same reasoning behind `ended`
being a duration: a seventeen-hour day is a real thing that happened, and "ended at 01:30"
throws that away.

How notebook "now" is actually computed — plus extended and negative hours, per-day
timezones, and the date types — is [its own document](nbfs.md).

## What's in the notebook

```
~/Sky/
  time/                            # every day, filed by year / month / week / day
  data/                            # tracking data, weather, location history
  decisions/                       # decision records
  goals/                           # personal and professional goals
  ideas/                           # idea capture
  journal/                         # about-me profile and question banks
  notes/                           # standalone notes
  orgs/                            # organizations
  people/                          # personal CRM
  places/                          # location hierarchy
  projects/                        # projects, with open/ for active ones
  streaks/                         # habit definitions: active/ and archived/
```

Most of the volume is under `time/`, which has a structure of its own: one directory per
day, nested inside the week it belongs to, holding the day file and everything that day
produced.

```
~/Sky/time/2026/03/30-05/03-31/day.md
```

That layout — and the reasoning behind it — is covered in
[Notebook time and NBFS](nbfs.md).

Dates are ISO 8601 (`YYYY-MM-DD`) everywhere — it sorts lexicographically, it's unambiguous
across locales, and it doesn't make you think.

## Two directories, different jobs

| Directory | Config key | Contents | Git? |
|---|---|---|---|
| `~/Sky` | `dir` | Your markdown notebook — everything above | Yes, this is the point |
| `~/Sky-Data` | `userDataDir` | Attachments, service state, temp files | No |

The split exists so the notebook stays a clean, diffable, human-scale git repository.
Binary attachments and machine state don't belong in your life's history.

## Configuration

`~/.sky/config.jsonc` — written by `sky init`, JSONC so it can carry comments:

```jsonc
{
  // Config version (do not change manually)
  "version": 1,

  // Root directory for your notebook
  "dir": "~/Sky",

  // Operational data — attachments, state, not git-tracked
  "userDataDir": "~/Sky-Data",

  // Preferred editor for opening files after creation
  "editor": "code",

  // Life domains — the prefix on day-file sections. Fixed for now.
  "categories": ["Professional", "Personal"],

  // Extra command directories, for commands you keep outside this repo
  "commands": {
    "dirs": ["~/sky-extras"]
  },

  // Slack workspace used by slack:* commands
  "slack": { "workspace": "https://yourteam.slack.com" },

  // AI model roles — these are the defaults
  "ai": {
    "models": {
      "strong": "anthropic/claude-sonnet-5",
      "fast": "openai/gpt-4o-mini",
      "transcription": "openai/gpt-4o-transcribe"
    }
  },

  // Port for the Sky service
  "server": { "port": 9999 }
}
```

**Model roles, not model names.** Commands ask for `strong` or `fast`; the config decides
what those mean. Repoint `strong` at a different provider and every reasoning-heavy command
follows, no code changes.

**`commands.dirs` makes Sky extensible without forking.** Point it at your own directory of
commands and they get discovered, named, and tab-completed exactly like the built-ins.

**API keys never go here.** They live in `src/.env`. This file is meant to be readable and
shareable; a config full of secrets isn't.

**`categories` is fixed at `Professional` / `Personal`.** The day skeleton, goals files, and
recurring and scheduled items all assume that pair, so editing the array doesn't change the
sections Sky writes. The key is in the config to reserve the shape, not to be tuned.

Two more keys the generated config doesn't show, both optional:
`commands.day.start` and `commands.day.end` list the commands that `sky day:start` and
`sky day:end` run for you. The defaults are `day:sr:update`, `prices:all:fetch`,
`util:weather` on start and `day:todo:incomplete` on end. A configured command that doesn't
exist is a warning, not a failure — `prices:all:fetch` isn't in this repo, so a fresh
install prints one line about it on the first `day:start` and carries on. Drop it from
`commands.day.start` to silence that.

### Environment overrides

Environment variables win over the config file — useful for testing against a scratch
notebook without touching your real one.

| Variable | Overrides |
|---|---|
| `SKY_DIR` | `dir` |
| `SKY_DATA_DIR` | `userDataDir` |
| `SKY_CODE_DIR` | `codeDir` |

## Where to go next

- [Notebook time and NBFS](nbfs.md) — the file layout and time model in depth
- [Commands](commands.md) — what's actually available
- [Architecture](architecture.md) — how the code is laid out, and how to add a command
