---
created: 2026-09-06
updated: 2026-09-06
---

# The message a restart took

## What happened

A kept thread came back from a restart at its last completed turn. The
message the person had just sent was not there — the crash snapshot was
written as a turn ended, never as it began — and nothing on the page or in
the list said a reply had been owed. The page that had sent the message
knew, from its own memory, and said so (the day before: "the page waits");
any other page, or the same page after a reload, saw a thread that had
simply never been asked.

## The rule

- A kept thread's snapshot is written as each turn begins, the message in
  it, and again as the turn ends. The session has a switch for this,
  `snapshotOnSend`, and the routes set it with the thread's keep setting on
  every message and every change: a thread that is not kept never gets a
  copy at rest, mid-turn or otherwise.
- A snapshot that ends on the person's message is a thread the service
  went down answering. On restore (`interrupted.ts`) that message is set
  apart from the conversation — the model never sees an unanswered turn,
  and a resend is a fresh turn rather than a merge into the old one — and
  rides the thread as `interrupted`, with its time.
- Such a thread lists as failed with "sky restarted while replying — send
  it again", and takes its name from the message when it has no other
  turns. `GET /chat/:id` carries `interrupted`; the next message on the
  thread, a resend or a new one, clears it.
- The page shows the message where the exchange would be — the bubble as
  sent, and under it "turn failed — sky restarted while replying." with a
  Send again beside sky's name. Send again is the ordinary send, with the
  thread's settings, so the resend is answered like any message.

## What it is not

A turn that survives a restart. The message survives; the reply is made
again on request. Nor does this reach a thread that is not kept: its
message lives only in the page that sent it, which says so on its own.

## Verified

- 2026-09-06 — a conversation ending on the reply restores whole with
  nothing interrupted; one ending on the person's message restores the
  exchanges before it and carries the message with its time, or an empty
  conversation and the message unstamped (helper test). A kept thread's
  model, reading the snapshot mid-turn, finds the message already there,
  and the reply beside it once the turn ends (route test). A restored
  snapshot that ended on the person's message lists as failed with the
  line and a title from the message, carries the message apart from the
  turns, and clears it once the message is sent again and answered (route
  test). The settings test's first expectation flipped with the rule: a
  kept thread's snapshot now exists before the model runs; a discarded
  thread's still does not.
