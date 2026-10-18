---
created: 2026-10-18
updated: 2026-10-18
---

# Restarts need new bytes

## What happened

The service restarted six times in a minute, about ten seconds apart, with
nothing in `src` edited. Each `reload` line in the log named a different
handful of server files, all last saved days before.

Their modified times had not moved, but their ctimes all fell inside that
minute. Tresorit, which syncs the repo, was stamping its `tresorit.fileId`
extended attribute on them. Its core log
(`~/Library/Application Support/Tresorit/Core/Logs/`) shows the same pass
failing with "Permission denied (errno=13)" on read-only git objects.
Reading an attribute works on a read-only file; only writing one fails that
way.

`fs.watch` cannot tell that from a save. macOS reports every change to a
file's record — bytes, permissions, timestamps, extended attributes — and
reading a file reports nothing. A boot takes about ten seconds; the next
batch of stamps landed while it ran, so each boot ended in another restart
until the pass was done.

## The rule

- When the gate starts it hashes every file it counts as server source,
  about 1,500 files in some 70 ms. The map lives in the process and is never
  saved: each fresh process takes its own, so it stands for the code that
  process loaded.
- After the 500 ms settle, each file an event named is hashed again. Only a
  file whose bytes differ, or that appeared or went away, marks a restart
  pending. The rest are dropped before "Restart pending" ever shows.
- When the root cannot be read there is nothing to compare with, and every
  reported change counts, as before.

An edit in the second or two between loading the code and taking the
hashes still goes unnoticed, as it did before.

## Rejected

- **Size plus modified time.** Cheaper, and enough for this pass, but a
  `touch` or a save of the same bytes would still restart.
- **The event type.** The same attribute write arrived as `change` in one
  run and `rename` in the next — FSEvents carries a file's earlier flags
  along — and `fs.watch` exposes nothing finer.
- **Hashes saved to disk.** They would describe the previous process's
  code, not this one's.
