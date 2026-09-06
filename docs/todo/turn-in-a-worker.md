---
created: 2026-09-06
updated: 2026-09-06
---

# The turn in a worker process

## The problem

Same as the browser-owned turn: a reply in progress dies with the service
process. This is the other way out, for the case where the turn should
keep running on the machine — closing the tab must not end a forty-minute
mission, and the day list should follow it from any device.

## The shape of the fix

Each thread's turn runs in a worker process the service spawns and only
proxies for. The service restarts, comes back, finds the worker still
running, and reattaches to its stream. The worker journals its events
with sequence numbers so the gap is replayed; a registry names the live
workers; approvals route through the service to the worker; orphans are
cleaned up.

## What it trades

A new protocol, an event journal, and orphan cleanup — a new failure
surface of its own. Worth it only if turns keep dying after restarts
learned to wait. On hold since 2026-09-05.
