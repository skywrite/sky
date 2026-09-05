---
created: 2026-08-30
---

# day:items — the day's lists as a voice surface

The voice assistant needed three abilities the CLI had only in pieces:
say what is on today's lists, add one item by ear, and strike one item
by a few of its words. `day:items`, `day:items:add`, and
`day:items:done` are those three, shaped as `@AIChatTool`s (no
approval — the read-back is the check) and equally usable from the
terminal.

## Shape

- **`day:items [-w day]`** returns every list with each item's text and
  done state. Text is cleaned for reading aloud: strike marks off,
  reference links flattened to their labels, the `HH:MM >` prefix kept
  because it is information.
- **`day:items:add <task> [list]`** is one door to the three writable
  lists (todos, commitments, reminders; loose singular/plural names).
  Category is `Personal`/`Professional` (default Professional); a
  commitment given `--time` carries the `HH:MM >` prefix and sorts into
  place. A todo for a day with no file falls through to the existing
  `day:todo:add` schedule path; commitments and reminders need the day
  started.
- **`day:items:done <words>`** matches by normalized substring across
  every non-Complete list. Exactly one pending match strikes; several
  matches fail listing the candidates; a match that is already struck
  answers "already done" instead of "not found".

Pure logic (normalize, find, strike) lives in `items/lib/items.ts` with
its tests; the commands own file I/O and wording.

## Two model facts the implementation leans on

- **`addItem(title, …)` on a missing list lands in the LAST list.**
  `findListFromIndexOrTitle` resolves a missing title via
  `findIndex → -1 → lists.at(-1)`, so `day:todo:add` writes into
  whatever list happens to be last on a day without that Todos list
  (observed live: a Personal todo filed into Reminders). The add
  command therefore uses `addTodoItem`/`addCommitmentItem`/
  `addReminderItem`, which create a missing list in its canonical
  position. The underlying hazard is left in place and flagged — a fix
  in `ListDocument` changes every caller.
- **Removing an item prunes its reference-link definitions** from the
  document, so the strike (remove, re-insert wrapped in `~~`) peeks the
  removed links first and rides them back in through `insertItem`'s
  `links` option.
