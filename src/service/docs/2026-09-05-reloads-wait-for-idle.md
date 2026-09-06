---
created: 2026-09-05
updated: 2026-09-05
---

# Reloads wait for idle

## What happened

The service ran under `bun --watch`. Every save of a file it imported
restarted it that instant — under a chat turn, an import, a forty-minute
document mission — and the page or the terminal was left holding a reply
that would never come. With several sessions editing the code at once,
that was a restart every few minutes.

The reload also re-exec'd the process in place and leaked one set of
watcher descriptors each time (oven-sh/bun#40706). Past 4,096 the service
recycled itself, one more restart at a moment of nobody's choosing; past
10,240 every child it spawned died on the spot.

## The rule

- The launcher runs the service in a loop, not under `--watch`. Exit code 3
  means "start me again"; anything else ends the loop and launchd's
  KeepAlive starts the launcher over. Every start is a fresh process.
- The service watches its own source. A change under `src` that the
  server imports or starts with marks a restart pending — not a change to
  the page's sources, which are built on request, nor to tests, docs, or
  fixtures. Saves within half a second are one restart.
- It leaves only once nothing is held: boot, a chat turn, a chat being
  filed, an import, a heartbeat tick, a voice conversation for two minutes
  past its last request. A short grace lets a response in flight land. The
  wait has no end but the work's own — a first cut forced the restart after
  fifteen minutes, and the rule became "until everything is done" the same
  evening — so the log says every half hour what it is still waiting on.
- The twelve-hour refresh and a descriptor table past its limit ask the
  same way, so neither lands on a turn either.
- The shell says "restart pending" under the brand while one waits, names
  what it waits on, and a click on it is "now".

## What it is not

A saved change no longer takes effect the second it is saved; it takes
effect at the next quiet moment, and a page or a session that saved it can
see that it is waiting. A turn still dies if the person restarts now, from
the shell or with `sky services sky-service --restart`, and those two are
the only ways a wait ends early — a hold that never lets go blocks restarts
until someone does.

## Verified

- 2026-09-05 — the filter says which paths call for a restart (server
  source, `.env`, `package.json`, the schema) and which do not (the page's
  sources, tests, docs, fixtures, node_modules, prompt files); a burst of
  saves with nothing held exits once with the reload code after the grace,
  a page file among them ignored; a save during a hold waits, says what it
  waits on, and leaves when the hold lets go; a wait with no end in sight
  says so now and then and never forces its way out; "now" leaves at once,
  held or not (gate test). Holds are listed while held and every release is
  heard; a timed hold renews on touch and lapses after the last (activity
  test). The launcher loop, run against a stub that asked for two restarts
  then exited clean, started the stub three times and ended with its code.
- 2026-09-05 — live: the first save under the new gate exited the old
  `--watch` process, launchd brought the launcher back on the new script,
  and the service booted fresh with 6 open descriptors where the old
  process started at 1,200. A touch while idle restarted it in twelve
  seconds, each start with its own log pair. A save under a running turn
  marked a restart pending with the turn as what it waited on; the shell
  showed "restart pending" with "waiting on chat turn" as its title; the
  turn streamed to its end, and the restart landed eight seconds after.
