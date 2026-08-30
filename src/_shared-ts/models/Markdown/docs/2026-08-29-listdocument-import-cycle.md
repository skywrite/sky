---
created: 2026-08-29
updated: 2026-08-29
---

# ListDocument import cycle

## Symptom

`bun test commands/all/day` failed two files with

```
ReferenceError: Cannot access 'ListDocument' before initialization.
    at _shared-ts/models/Day/document/mod.ts:40  (class DayDocument extends ListDocument)
```

reported "between tests". The whole-tree run was green, and so was every
suite run on its own that happened to import `Day` before `ListDocument`.
The count of failures changed with the set of test files in the process.

## Cause

`ItemList/mod.ts` imported `Document` through the family barrel,
`Markdown/mod.ts`. The barrel re-exports `MarkdownStore`; `Store/mod.ts`
imports every document store; `StreakStore` reaches `Streak/stats`, which
imports `Day`; `Day/document/mod.ts` imports `ListDocument`.

Entering from `ListDocument`: it starts evaluating, imports `ItemList`,
which imports the barrel, which walks to `Day`, which imports `ListDocument`
— still evaluating, so the binding is in its temporal dead zone — and
`class DayDocument extends ListDocument` throws. Entering from `Day` is
fine: `Day` waits for `ListDocument`, which finishes before anything
extends it. That is why order decided everything.

## What was rejected

- **Preload `Day` in the test runner, or order the test files.** Hides the
  cycle; any command whose first import is a list document still trips it.
- **Lazy-import `Day` inside `Streak/stats`.** Breaks the cycle at the far
  end and leaves the barrel import in place for the next module to copy.

## Fix

`ItemList` and `Store` import `Document/mod.ts` directly. The family rule is
in the README: siblings import each other directly, never the barrel. A
regression test spawns a process that imports `ListDocument` first, then
`Day`, and asserts a clean load.
