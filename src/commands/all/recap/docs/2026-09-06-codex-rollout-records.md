---
created: 2026-09-06
updated: 2026-09-06
---

# Codex sessions have multiple representations of the same work

The Claude Code recap already supplied the desired notebook behavior, but
Codex rollouts could not be treated as Claude transcripts. Their metadata,
messages, tool calls and completed actions use different record types.

Local schema inspection showed both older function/custom-tool records
and newer `event_msg.item_completed` records. A code-mode `exec` call can
contain several nested commands and patches. Parsing its JavaScript text
would miss dynamically built arguments and could mistake examples for
actual actions. Completed `CommandExecution` and `FileChange` items record
the actions themselves, so the reader uses those and supports legacy
tool results alongside them. Successful completion is required before
claiming a file change or commit.

One typed request can also appear as a response message, a `user_message`
event, and a completed `UserMessage`. Counting all three inflates engagement.
The reader reconciles mirrored user events by text and nearby timestamps,
preserving repeated prompts from the same event stream. Response messages
are a fallback for transcripts without user events; known injected context
is excluded. Reasoning and context-compaction payloads are never digest input.

Rollout paths reflect session creation, not the dates of all subsequent
work. A session created in January can resume in February, and archiving
moves its file. Discovery therefore walks both active and archived trees,
slices by event time, and deduplicates session IDs. Delegated subagent and
noninteractive execution transcripts are excluded from this user-work recap.

Both coding commands now share the session renderer, digest prompt and
recap-writing workflow. Sharing the day boundaries also required replacing
the recap group's legacy JS dates with nbdt's exact `Instant` adapter;
rounding timestamps to notebook minutes would lose events at a day's edge.
The existing GitHub and Claude tests continue to exercise the same output,
with added coverage for offset timestamps and daylight saving transitions.

All fixtures use synthetic sessions and paths. The tests cover current and
legacy records, mirrored prompts, resumed and archived sessions, failed
actions, malformed tails, forks, and exact window boundaries.
