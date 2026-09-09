---
created: 2026-09-08
updated: 2026-09-08
---

# Streaks in the app

The app reads rule documents from `streaks/active/` and `streaks/archived/`,
and completion records from each day's `## Streaks` list. A rule's title is
the exact join key, with the optional trailing run count and outer strike
marks removed by `StreakDocument`. Creation reserves titles across both
statuses; the app has no rename operation because changing a title would
detach its existing history. Ambiguous names, titles, or day items remain
visible through warnings and cannot be changed through the app.

Reports never create or stamp files. They read only the configured `day.md`
paths in bounded batches, from the earliest rule start through notebook
today. Current and best runs use `computeStreakStats`; an unfinished today
is pending, while a missing past scheduled day breaks the run. The host uses
the notebook's started-day clock, so after midnight check-ins still belong
to the open day. A notebook with no started day falls back to the calendar
date and can create its first rule without running setup or AI.

A completion requires an existing, open day within the rule's schedule and
start/end bounds. Ended days retain the day app's read-only contract;
historical corrections work on open days, including for archived streaks.
An item is inserted only when the user checks it off, using line edits that
preserve unrelated day content. Viewing or creating a rule does not rewrite
past days. The document remains the place for arbitrary narrative; the app
recognizes conventional Why and What counts sections and keeps the full body
available as escaped, link-filtered HTML.

App mutations serialize with the streak writer lock. Completion and Undo
also take the day planning and workstream day locks in the same order as
the day app. They recheck expected completion state and saved bytes before
writing. The locks coordinate app writers; external editors do not share
them, so changed bytes cause a conflict rather than an overwrite when seen
at the final check. Paths cannot traverse outside the notebook or follow
notebook symlinks.

Archive moves the rule without touching daily history, clamping its end to
the earlier of its planned end and notebook today. Undo is a short-lived
in-memory token holding the exact before/after versions. It restores only
while its saved bytes still match and, for archive, the active destination
is still absent. It restores the original planned end and refuses to erase
subsequent edits. Restarting the service expires those tokens.
