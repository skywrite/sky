---
created: 2026-09-10
updated: 2026-09-10
---

# Machine-bound commands move to sky-extras

## The problem

Some commands in this repo only make sense on one person's machine. They
are run by a launchd job, need a native helper on that job's PATH, or act
on a folder layout nobody else has. `util:desktop:rename` is the example:
a desktop watcher runs it, it needs `gui-prompt` installed where the
watcher can see it, and it renames, moves, or trashes files on the desktop.
`util:desktop:sweep` is its sibling. Carrying them in the public CLI means
every reader meets dependencies they will never need, and the dependencies
doc grows rows for one person's workflow.

## The shape of the fix

A new public repo, `skywrite/sky-extras` — it does not exist yet — holding
the commands that are optional by nature. The CLI already loads command
folders named in `commands.dirs`, and the external-commands recipe already
says how such a folder is built: one `package.json` per command group,
importing the public `@skywrite/*` packages, never the private `#` aliases.
The move is one command per commit, and sky-oss keeps the framework, the
notebook, and everything a second person would run on day one.

Candidates, confirmed one at a time rather than swept: `util:desktop:rename`
and `util:desktop:sweep` first; after that, anything whose only caller is a
launchd job or a private tool.

## What it trades

The `@skywrite/*` packages resolve today through a sibling checkout (`file:`
dependencies into this repo), so the new repo either documents that layout
as the supported one or waits for the packages to be publishable. That
call is open and comes first. Each moved command also loses the `#`
aliases; whatever it needs that the packages do not export gets exported
from `packages/core` before the move, not copied. The launchd job that
runs `util:desktop:rename` keeps working unchanged, since the CLI resolves
an external command by the same name.
