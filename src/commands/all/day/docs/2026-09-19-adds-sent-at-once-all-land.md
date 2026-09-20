---
created: 2026-09-19
updated: 2026-09-19
---

# Adds sent at once all land

## What went wrong

A chat was asked to add four todos to one day.
The answer said four were added.
The day file held one.

Nothing failed. Every tool call reported success, so the model repeated it.
The loss showed only when the file was opened.

## Why

A model asked for several items sends the tool calls in one step.
The AI SDK runs a step's tool calls together, under `Promise.all`.
That holds on both the generate path and the stream path.

`day:items:add` read the whole day file, added its item in memory, and wrote the whole file back.
Nothing held the file between the read and the write.

So all four adds read the same original file.
Each wrote back "the original plus my one item".
The last write won and erased the other three.

The chat's timing log showed it plainly: four tool spans starting within 3 ms, each about 20 ms long.

`day:items:done` had the same shape: two strikes at once could un-strike one.
`day:todo:add` had it on both branches, the day file and the schedule file.

## What was rejected

**Running tool calls one at a time in the chat executor.**
Wrong layer. Read tools run together safely and would slow down for nothing.
The CLI and the service writing the same day would still race.

**A new lock per file.**
The web day page already takes a lock around every item write: `day-<ymd>.lock` in the workstreams state directory.
A second lock would stop two commands from colliding, and leave a command and the page free to collide.

## The fix

`withDayWrite(config, ymd, run)` in `lib/nbfs` takes the day page's own lock.
`withScheduleWrite(config, run)` takes one lock for both schedule files.
They hold every future date in the same two files, so a per-day lock does not cover them.

Both sit on `withLock` from `lib/outbox/files.ts`.
It works across processes, so the CLI and the service queue on it too.
Lock files live in the state directory, outside the synced notebook.

Three commands take them, around the read-to-write section only:

- `day:items:add`
- `day:items:done`
- `day:todo:add`, the day lock on one branch and the schedule lock on the other

Four adds sent at once now queue. Each reads the file the one before it wrote.

## The lock does not nest

`withLock` is not re-entrant. A second take of a held lock waits, then fails.

`day:items:add` hands a todo for a day with no file to `day:todo:add`.
It does that before taking its own lock, never inside it.
A writer that holds the day lock must not run another day writer inside it.

## What this does not cover

Other commands still write a day file with no lock: the callers of `writeDayItems` and `writeDay`, the move and sweep commands, the ledger lines that imports add.
Each has the same 20 ms window against any other writer.
They were left alone here: none of them is sent in parallel by a model, and each needs its own look at where the read starts.

The rule from here on: a command that reads a day file in order to write it takes `withDayWrite` around both.

## Verified

`items/add_test.ts`, on a temp notebook:

- four adds started together: four successes, four items
- two strikes started together: both stay struck
- four schedule adds for one future date: all four filed
- an add started while the day page's lock is held: writes only after the release

With the two helpers switched to a plain `run()`, all four fail.
The add test then keeps one item of four, which is the loss that was reported.
