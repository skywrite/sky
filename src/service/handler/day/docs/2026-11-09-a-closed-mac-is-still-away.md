---
created: 2026-11-09
updated: 2026-11-09
---

# A closed Mac is still away

## What was wrong

The morning review did not appear after nights with the Mac asleep, lid closed, for far longer than the five idle hours.
The service ran all night and the notebook's day was behind the calendar, so nothing else stood in the way.

The idle check sampled macOS's `HIDIdleTime` every thirty seconds and took `now - idleMs` as the moment of the last input.
That subtraction holds only while the Mac stays awake.
`HIDIdleTime` does not count time asleep, and a sleeping Mac does not stay asleep:
it wakes itself in the background every fifteen minutes or so for network and maintenance work, dozens of times a night.
The service runs during those wakes.
At each one the timer read far less than the hours since the last key press,
the subtraction named a moment shortly before that wake, and the check recorded it as fresh input.
The longest stretch it ever measured was the gap between two background wakes.

The check had no log, so the cause came from the system's own records:

- `pmset -g log | grep -E "DarkWake|Wake|Sleep"` lists every sleep, background wake (`DarkWake`) and full wake.
- `sysctl kern.sleeptime kern.waketime` gives the kernel's last sleep and last wake;
  the wake matches the latest entry of either kind, so background wakes move it.

## What was considered

- **The lid.** Rejected: a Mac on an external display is used with the lid closed.
- **Only a full wake counts.** Rejected: a notification lights the screen for a few seconds with nobody there,
  and the power log records that as a full wake.
  Since the prompt now starts the day, a notification at three in the morning would have started it.
- **The timer going down between samples.** It does mean input, but after a sleep the opposite proves nothing:
  a key pressed ten seconds ago reads higher than a timer that stood at two seconds all night.
- **Discarding samples that took too long.** A sample the Mac sleeps through pairs an old timer with a new clock.
  Reading the clock first makes the same sample harmless without a second rule.

## Why the fix works

An input counts only when the idle timer is younger than the last wake: `idleMs < now - wokeAt`, less two seconds.
With no key pressed since the wake, the timer cannot be younger than the wake however it treats sleep.
If it stops while asleep, it holds what it had plus the time awake since.
If it counted through the sleep, it holds more.
If the wake itself restarted it, the two are equal, and the two seconds cover the stamp order.
So background wakes, a screen lit by a notification, and the key press that causes a wake all leave the last input alone,
and the next key press measures the whole night.

`now` is read before the timer.
A sample the Mac sleeps through then compares a timer read late against a clock read early,
which can make the timer look older and never newer.
A reading taken while the kernel's last sleep is later than its last wake is skipped.

Across a restart, the evidence of idleness is the time since the last real input, recorded at every sample,
background wakes included.
A service that restarts in the middle of the night still offers the review in the morning,
and a service that was down while the person worked still does not take its own downtime for sleep.

The check now writes one line when someone returns after the configured hours:
`Day review: back after 8.5 hours away; offering 2030-06-17`.
That line, or its absence, is the first thing to read the next time a prompt is missed or unexpected.

`review/idle_test.ts` replays such a night: a background wake every fifteen minutes for ten hours, a notification,
the waking key press, then a key pressed after the wake.
