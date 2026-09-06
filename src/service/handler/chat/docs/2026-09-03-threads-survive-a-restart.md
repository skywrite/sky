---
created: 2026-09-03
updated: 2026-09-03
---

# Threads survive a restart

A web thread lived only in the service's memory. Its every completed turn
was already written to the state directory as a crash snapshot, the same
insurance the terminal keeps, but nothing read those snapshots back. So a
restart — and the service restarts itself on every edit under it — emptied
the day's threads while their conversations sat on disk. This afternoon it
took a two-turn thread off the page while its owner was looking at it.

## The rule

A thread that has a snapshot is a thread. When the chat routes start they
read the service's own snapshots back — the ones named by a thread id, not
a terminal's pid — oldest start first, and make each a thread again:

- its turns are on the page at once, since a session now seeds its
  conversation the moment it is built rather than at its first message;
- its context is restored at its next message, from the log the snapshot
  carries, exactly as a resumed transcript restores;
- it keeps the start it had, so it writes the same snapshot and files
  under the day it began when it is ended;
- its name comes from the titler once it has an exchange, as for any thread.

The session model gained one option for this, `restore`: the state to pick
up when there is no file to write back to. A resume both seeds and writes
back; a restore seeds and files as new. Only an ended thread removes its
snapshot. A snapshot that will not build is skipped and left for a later
run; the rest of the day still opens.

## Verified

- 2026-09-03 — a snapshot name reads back as its start and session, late
  hours kept, and a stranger is refused; a directory lists its snapshots in
  start order and tells a thread's from a terminal's (store tests). A
  session built with a restore shows its turns before it starts and files
  as a new chat when ended (session test). A host that hands the routes a
  snapshot lists the thread with its turns and title before any message,
  and a message continues the conversation (route test).
