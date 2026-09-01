---
created: 2026-08-30
---

# The Sky/Follow/Now door

Labeling an old thread `Sky/Follow` filed each message on the day it was
sent — weeks back, where nobody looks — and a thread already quiet past
the 14-day window was captured and closed on the spot. Right for
archiving correspondence; wrong for "I'm picking this up now."

## Two doors, one bucket

`Sky/Follow` keeps its behavior: each message lands on its own date, the
watch anchors on the thread's real activity, and stale threads are
captured and closed immediately.

`Sky/Follow/Now` files the whole thread as one entry on the day the
sync picks it up — one `##` section per message, real timestamps inside
— so it lands in today's day file, context, and recaps. The watch
starts at pickup: the capture's date anchors the inactivity clock, so
even a months-old thread gets the full 14-day window.

## The swap

After first capture, a Now thread trades `Sky/Follow/Now` for bare
`Sky/Follow` (first captures leave the inbox in the same call). The
sub-label therefore reads "queued", the bare label "being tracked", and
no label "closed out". A Now label lingering on a tracked thread — a
hand-labeled bump, or a swap Gmail dropped — is healed on the next
sync, so it can never outlive its follow and re-capture the thread.

From there both doors share one lifecycle: replies file on the day they
arrive and reset the clock; 14 quiet days removes the label and
archives the follow YAML. Re-labeling a closed-out thread with `/Now`
starts over: the full thread re-captures as one entry on that day.

The sub-label is optional — an account without it in Gmail simply has
no Now door. `--label X` scans `X/Now` the same way.
