---
created: 2026-09-06
updated: 2026-09-06
---

# Voice tool calls wait through a restart

## The problem

Voice audio runs between the browser and the Realtime API and is untouched
by a service restart. The tool calls the model makes go to the service,
and a call that lands in the twelve seconds the service is away fails
once; the model hears a tool error and the conversation goes on without
what it asked for.

## The shape of the fix

The voice page waits and retries the way the chat page now does: a failed
tools call polls for the service on the restart schedule and sends again
once it answers, so the call completes a few seconds late instead of
failing. The service-side thread is rebuilt on the next call already.

## What it trades

A few seconds of silence from the model while it waits on the tool, in
place of an error it has to explain. Small; independent of the rest.
