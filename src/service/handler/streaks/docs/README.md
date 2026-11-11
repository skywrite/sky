---
created: 2026-09-08
updated: 2026-11-11
---

# Streaks in the app

The app reads rule documents from `streaks/active/` and `streaks/archived/`,
and completion records from each day's `## Streaks` list. A rule's title is
the exact join key, with outer strike marks removed by `StreakDocument`.
Older day files carry a stamped run count after the title (`— 12d`); it is
stripped when matching and never written again
([why](2026-09-19-the-run-count-leaves-the-day-file.md)).

A title is taken only on the days a streak with that title is tracked, active or archived.
It is free again from the day after that streak's end, so a new streak can reuse an archived one's title.
This is safe because every reader counts a streak only between its own start and end:
two streaks whose dates never meet keep separate histories although the day files spell both the same way.
`streaksShareDays` in the shared Streak model is the one rule; the form, the app store, and the CLI writer all use it.
A streak with no readable start, or with no end, stays in the way of its title.
The new rule gets its own name (`read-a-chapter-2`), because names stay unique across both statuses.
The app and the CLI pick that name the same way (`freeStreakName`); a name the person chose with `--name` is refused instead.

The app has no rename operation because changing a title would detach its existing history.
Ambiguous names, titles that share days, or duplicate day items remain visible through warnings
and cannot be changed through the app.

Reports never create or stamp files. They read only the configured `day.md`
paths in bounded batches, from the earliest rule start through notebook
today. Current and best runs use `computeStreakStats`; an unfinished today
is pending, while a missing past scheduled day breaks the run. The host uses
the notebook's started-day clock, so after midnight check-ins still belong
to the open day. A notebook with no started day falls back to the calendar
date and can create its first rule without running setup or AI.

A completion requires an existing, open day within the rule's schedule and
start/end bounds. Summarized days retain the day app's read-only contract;
historical corrections work on open days, including for archived streaks.
An item is inserted only when the user checks it off, using line edits that
preserve unrelated day content. Viewing or creating a rule does not rewrite
past days. The document remains the place for arbitrary narrative; the app
recognizes conventional Why and What counts sections and keeps the full body
available as escaped, link-filtered HTML.

App mutations serialize with the streak writer lock. Completion, archive, and Undo
also take the day planning and workstream day locks in the same order as
the day app. They recheck expected completion state and saved bytes before
writing. The locks coordinate app writers; external editors do not share
them, so changed bytes cause a conflict rather than an overwrite when seen
at the final check. Paths cannot traverse outside the notebook or follow
notebook symlinks.

Archive moves the rule without changing its recorded completions, clamping
its end to the earlier of its planned end and notebook today.
The rule is filed under `streaks/archived/<year>/`, the year of that end, so the folder follows from the document.
Rules archived before year folders sit directly under `streaks/archived/`; every loader walks the whole folder,
so both layouts read the same and nothing moves them.
It adds a
timestamped archive entry to today's category Complete list, using the same
notebook clock and entry format as the CLI. A missing day is prepared without
starting it; a summarized day requires starting a new day or removing its summary first.
The rule move and day entry save together, rolling back failed writes only
while their bytes still match. Undo is a short-lived in-memory token holding
the exact before/after versions. It restores only while all saved bytes still
match and, for archive, the active destination is still absent. It restores
the original planned end and removes the archive entry without erasing
subsequent edits. Restarting the service expires those tokens.

The streak's optional `category` is Personal or Professional. An explicit
choice wins, then a saved category, then inference through `aiModel('fast')`
(Haiku 5.5 by default). The shared `lib/streaks/category.ts` classifier uses
the title, purpose, rules, tags, and linked project/goal context. Creation
saves its result; legacy streaks are classified when archived. Viewing never
classifies or rewrites a streak. The app's category selector and the CLI's
`--category` override inference. Creation and archive entries use the saved
category consistently across the two callers.

Inference runs outside the writer locks; archive rechecks the revision
afterwards so a concurrent correction wins. It has a ten-second model
timeout and no retries. If unavailable or undecided, the operation still
succeeds, warns, and uses Personal for any day entry without saving that
fallback as a category. A later mutation can retry, or the owner can choose
a category explicitly. Archive Undo restores the original metadata as well
as the day record.
