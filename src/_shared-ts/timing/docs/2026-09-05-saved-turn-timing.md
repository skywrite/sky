---
created: 2026-09-05
updated: 2026-09-05
---

# Timing belongs to the saved turn

Daily performance logs survive restarts, but a chat file previously carried
neither its timing nor a trace reference. The displayed report was computed
after the session snapshot, so adding it to the report alone could never make
the chat independently analyzable.

The existing v2 context log already stores per-turn tools and token usage.
An optional `timing` field now holds both the summary and individual spans,
including nested commands and repeated calls. This is additive: bumping the
format version would unnecessarily orphan older transcripts' resume state.

The boundary is prompt acceptance to result-ready. On the web it begins
before thread construction and initial context loading; on the terminal it
begins at the shared session's send boundary. The session finishes the trace,
freezes a copy on the current turn, then writes its snapshot. The write itself
is outside that duration: including the final measurement's own persistence
would require another measurement and another write indefinitely. Time spent
typing, idle between turns, browser transport/rendering, and post-conversation
filing are not prompt-to-result work.

Notebook transcript timestamps intentionally have minute granularity. They
cannot measure a 45.25-second reply within one minute. Timing therefore keeps
UTC instants with millisecond precision via nbdt's `instantNow()` alongside
the existing monotonic elapsed durations. A clock adjustment changes wall
stamps, never elapsed time. Existing notebook date/time types are unchanged.

Tests read real snapshots and saved files after synthetic timed turns, check
that separate calls remain separate, and resume and re-save without changing
prior entries. Branches keep their inherited timing but write only their own
turns. Failed turns retain an error outcome. An unfinished background span is
marked incomplete in the frozen archive, never retroactively rewritten when
the background operation eventually ends.
