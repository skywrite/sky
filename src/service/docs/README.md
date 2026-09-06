---
created: 2026-09-05
updated: 2026-09-05
---

# The service process

`bin/sky-service` is what launchd runs: it takes the lock, finds bun, and
starts `commands/all/service/start.ts` in a loop. The service exits with
code 3 when it wants to start again, and the loop starts it; any other exit
ends the loop and launchd's KeepAlive starts the launcher over. Each start
gets its own pair of logs under `/tmp/sky-service/`.

## Restarts wait for idle

The service watches its own source (`reload.ts`) — everything under `src`
that the server imports or starts with: `.ts`, `.tsx`, `.json`,
`.graphql`, `.env`. Not the page's sources under `handler/theme/client`,
which are built on request; not tests, docs, or fixtures. A change marks a
restart pending. The process leaves only once nothing is held, after a
short grace so a response in flight lands — however long that takes, with
a line in the log every half hour while it waits. The twelve-hour refresh
and a descriptor table past 4,096 ask for a restart the same way, and so
does the person, from the shell, which is the one way to cut a wait short.

What holds the process (`activity.ts`): boot itself, a chat turn, a chat
being filed, an import running, a heartbeat tick with its follow checks
and automation runs, and a voice conversation for two minutes past its
last request. A hold is taken where the work starts and released where it
ends; a timed hold covers work the service only hears from in bursts.

The log (`/tmp/sky/logs/service.<date>.jsonl`) carries `reload-pending`
when a change lands, `reload-deferred` with what it waits on,
`reload-waiting` every half hour it goes on waiting, and `reload` as it
leaves.

`GET /service/status` answers `{ pending, holding }`; `POST
/service/restart` leaves now. The shell shows "restart pending" under the
brand while one waits, its title naming what it waits on, and a click on it
is "now".

## Notes

- [2026-09-05 — reloads wait for idle](2026-09-05-reloads-wait-for-idle.md)
