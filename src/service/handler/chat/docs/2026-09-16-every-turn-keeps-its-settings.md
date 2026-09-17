---
created: 2026-09-16
updated: 2026-09-17
---

# Every turn keeps its settings

A chat's model, effort, and reading budget can change between turns.
The saved transcript's frontmatter names one model: the one set when
the file was saved. The turn-by-turn record lives in the `CONTEXT-LOG`
block at the end of the file.

Each entry named its model, preset, and effective effort only once the
reply had arrived, as three loose fields. A turn that failed recorded
none of them. The reading budget lived only in the assembly stats, so a
turn whose context pipeline broke, or that was stopped before it ran,
had no budget on record. The crash snapshot written while an answer
runs had no settings for the turn in flight either; recovery fell back
to the previous turn's model.

Now the session stamps one `settings` object on the turn's log entry as
soon as the context is settled, before the model runs:

```json
"settings": {"model": "claude-fable-5-1", "preset": "default-fable-5.1", "effort": "high", "contextTokens": 300000}
```

Whatever the turn does after that — answers, fails, or is interrupted —
the entry says what it ran under. `contextTokens` is 0 when the notebook
is closed. The object sits beside `stats`, `usage`, and `timing`, each
one concept; and the reading budget as set now reads apart from
`stats.budget`, the assembler's ceiling for that assembly, one of the
scoring parameters a logged score is read against and absent when no
assembly ran.

The files already on disk were rewritten into the same shape on
2026-09-17: every entry that carried the loose fields now carries
`settings`, its budget taken from the turn's own assembly stats. Only
those lines changed; the rest of each file is byte-identical, and the
crash snapshots were rewritten too, so a thread restored after the
change reads its own history. The reader knows one shape.

## The header names no model

The transcript's YAML header carried `provider:` and `model:` — the model
set when the file was saved, which a chat that switched models along the
way could contradict on every turn. Nothing read them back: the session,
resume, restart recovery, and the page take the model from the thread's
own settings or the recovery blob. From 2026-09-17 neither line is
written, in saved chats or in crash snapshots; each turn's `settings`
is where the model lives. Files written earlier keep their two lines
until their next save rewrites the header, and are read as before.
