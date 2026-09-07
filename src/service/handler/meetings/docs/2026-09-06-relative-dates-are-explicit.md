---
created: 2026-09-06
updated: 2026-09-06
---

# Relative dates are explicit

A request such as "Meet Jane today at 5 PM" could trigger a question about
whether a weekend meeting was intentional and leave the date blank. The
meeting call used the fast AI role. Prompt checks also found that it could
invent today's date when no day was supplied.

Meeting interpretation now uses the balanced AI role. Its instructions
distinguish a supplied relative day from a missing day, permit any day and
hour, and retain explicit past times for review. Creation still requires
a future time.

Only a weekday explicitly written in the request can constrain a supplied
date. The AI extracts that weekday separately; nbdt checks the calendar
arithmetic. This prevents a missed weekday/date disagreement from silently
becoming an invitation. It does not interpret the natural-language request.

Live checks use synthetic invitees and stop at the draft. They cover today
on a Sunday, a late evening, tomorrow, an omitted day, and an explicit
weekday/date conflict. No invitation is created by these checks.
