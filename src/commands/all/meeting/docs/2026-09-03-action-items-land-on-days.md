---
created: 2026-09-03
updated: 2026-09-03
---

# Action items land on days

"Right now next-professional is where they're going to die."

The action-item step offered every item the summary found and sent each
accepted one where the words said: a day and time the transcript named
became a Commitment on that day, a day alone a Todo, and anything undated
went to the Next list. Most items are undated. The Next list had dozens
waiting, and the step added to it every meeting.

## What changed

Every item now arrives with a proposed **when**, and the answer says where
each accepted one goes. The proposal is the day and time the words named,
or tomorrow — never Next. Next is one choice among the days, with its
waiting count shown beside it, so choosing it is choosing it.

On the page each row carries a chip: Today, Tomorrow, the rest of this week
by name, another day, a time, Next. One chip in the lead sentence moves the
whole batch ("Ticked items go to **Tomorrow** unless a row says otherwise")
and a row's own chip sets just that row. A time given by hand makes the item
a Commitment on its day; clearing it makes it a Todo. After Accept the page
shows where everything went, grouped by day, with the day a link away, and
says which items did not land and why.

The terminal did not change shape. It keeps its multiselect, and each
ticked item takes the when it arrived with; only the hint changed, from a
file name to "→ Tomorrow".

## The seam

The step is a new question on the prompt seam, `place`: items with a
proposed when, today's date, the last created day, the fallback, and the
Next count. `PlacePrompt` is domain-shaped on purpose, as `form` already is
for the names review — a host that can only tick answers with the proposals,
and a host with room lets the person move each item. The answer rides on
the `answered` event so a page opened later can still say what was decided.

The words — "Today", "Tomorrow", "Fri 13 Mar · 09:30", "Next", and which
list takes an item — live in `universal/dates/whenLabel`, reachable from the
command and from the browser, so the hint, the ledger, and the chips agree.

## What a day beyond the week means

A day whose file does not exist yet cannot take the item directly. It goes
to the schedule file under its date, time kept, and the morning's
`day:schedule:update` puts it under Commitments or Todos by the same split.
The page says so in words on the row: "its week isn't created yet · lands on
the day when it is".
