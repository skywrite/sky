---
created: 2026-09-05
updated: 2026-09-05
---

# The chats folder is named once

## What happened

Saved chats file under a day's `actions/ai-chats/`. Until today the
folder's name was spelled wherever it was needed: five path joins that
built it and a handful of substring checks that recognised it, spread
over the chat model, the session restore, the day route, the CLI, the
memory telemetry, and the journal and voice context gatherers. The
type registry in the Markdown collection kept its own copy.

A folder spelled in twelve places cannot be renamed without a sweep.
The question that surfaced it was whether the chats folder should
become `ai/chats`, with an `ai/voice` sibling for spoken sessions.

## Why the location, not a field

The notebook types a file by where it lives, in the Rails sense of
convention over configuration. A `type:` field in frontmatter was
weighed and refused. It would be a second source of truth beside the
location, so every reader would need a tie-break. A typo in it would
drop a file from every query with no trace, where a misfiled file is
at least visible. A file dropped into a day folder from Finder would
never carry it. And listing a folder costs one readdir, where typing
by content means opening every file.

The day layer already shows the convention working: every site goes
through `dayDir()`, which is why the week-dir move of 2026-08-30 was a
config flip and a rename-only commit. The kind folders under
`actions/` never got the same helper. That gap was the smell, not the
convention.

## What changed

- `dayAIChatsDir(date)` builds a day's chats folder, relative to `time/`
  like its siblings. `AI_CHATS_DIR` and `ACTIONS_DIR` are exported for the
  one place that prints the layout to a person, the ai:chat help text.
- `isAIChatPath(path)` recognises a chat by its folder, at any depth,
  absolute or day-relative. The collection's `chat` type is that
  function now.
- Every writer and reader goes through the two. No source file outside
  `dayAIChatsDir.ts` spells the folder's name. Comments that did now say
  "the chats folder".

Renaming the folder is now one string plus a notebook move: the files,
the day-file links that point at them, and the context logs that
recorded them.

## Verified

- `dayAIChatsDir_test.ts` (3 tests) and `isAIChatPath_test.ts` (2 tests,
  6 assertions), synthetic paths only.
- Full unit suite: 4156 pass, 0 fail. `bun run dev:check` green.
- The service restarted under the edits; its 13 kept web threads came
  back from their snapshots, none busy.
