---
created: 2026-09-08
updated: 2026-09-08
---

# One automation, many commands

Selecting several commands in the automation builder generated a separate charter
for each one. A morning recap request could become five independent automations,
each needing its own schedule edits and pause control. The multiple selector
suggested a group, but the file generator and execution model both assumed one
command per automation.

An automation now owns an ordered list of commands. A charter can declare
`commands:` with `run:` and optional `args:` for each entry, alongside one shared
trigger, status, end date and brief. Legacy top-level `run:` / `args:` charters
normalize to a one-entry list. Mixing the two forms is rejected so no commands
are silently ignored.

Both written requests and direct selection produce one proposal and one create
operation. Customize carries the complete command list forward. Adding commands
to an existing charter expands it under its existing filename and preserves its
status and metadata; command YAML nodes move with their comments between forms.

The scheduler and manual runner share the same sequential executor. Recap sources
are independent, so a failed command should not suppress the remaining recaps.
Every command is attempted, with the existing timeout applied to each command
individually so a larger group gets enough time to finish. One overall result
records individual outcomes, with failure taking precedence over acted and nothing.
One schedule stamp prevents an already-attempted group from rerunning each tick.
After timeout, an unfinished command may still settle, but its result is ignored
and the remaining commands are not repeated.

Existing separate charters are not merged automatically: matching schedules do
not establish that independently created jobs were intended to be one automation.
The browser regression uses five synthetic recap commands and verifies one file,
one switch, all five invocations, editing, retries and the legacy conversion.
