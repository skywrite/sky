---
created: 2026-09-03
updated: 2026-09-03
---

# A nested command inherits its caller's flags

A screenshot of the web import's action-item step: ten items, every row
"→ next-professional". Under it, in the service log, three `next:add` runs
in the same second, each `Cannot find list Next.` The ticked items were
nowhere — not in the Next file, not in any day file, not in the schedule.

The Next file was fine; it had a `## Next` list with dozens of items. What
`next:add` was looking for was a list called **Professional Complete**.

## Why

`resolveCommandArgs` gives a composed command the arguments of the command
that called it, then applies its own defaults to whatever is still missing,
then lets explicit overrides win. That is what makes `--when` flow from
`meeting:new` into the pipeline it runs without every call restating it.

But `meeting:new` has a `category` flag — the day list a meeting is filed
under, `Professional Complete` — and `next:add` has a `category` flag of
its own, meaning which list in the Next file, default `Next`. Same name,
different meaning. Inheritance filled `next:add`'s flag before its default
could, and the router only ever passed `task`. `day:todo:add` took the same
inheritance and, on a day whose file existed, went looking for
"Professional Complete Todos".

The route for timed items writes the day file directly and never noticed.
The first web imports went out on 2026-09-02; every accepted undated item
since then was silently lost — the ledger printed the failure, but on the
page it was one gray line in a log nobody opens.

## The cure

The routes name their list on every call: `next:add` gets
`category: 'Next'`, `day:todo:add` gets `category: 'Professional Todos'`.
An override beats inheritance; that is the resolver's own rule. The route
code moved out of `new.ts` into `lib/actionItemRoutes.ts`, where a test
resolves both commands inside a scope carrying `Professional Complete` and
shows the inherited value, then the named one.

The resolver itself is unchanged. Inheriting a same-named flag with a
different meaning is a trap worth knowing about in every composed call; the
general fix — typing flags by meaning, not by name — is a bigger change
than one lost list, and not this one.
