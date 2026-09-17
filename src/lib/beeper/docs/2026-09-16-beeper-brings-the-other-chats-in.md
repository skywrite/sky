---
created: 2026-09-16
updated: 2026-09-16
---

# Beeper brings the other chats in

## The problem

Outbox could only see what reached the notebook: Slack through agent-slack,
mail through the Gmail follow sync. Everything a person answers on their
phone — WhatsApp, iMessage, Signal, Telegram, Instagram, LinkedIn — never
reached the notebook, so it never reached Outbox, the recaps, or the people
graph. Beeper Desktop already gathers those networks on this Mac and, since
2025, serves them over a local API with an approval flow of its own.

## The shape

One adapter, not one per network. The desktop app is the source and the
destination; the network is what the person sees. A capture is a saved
message like any other, with two extra ids so Outbox can find the chat
again. The reply goes into the chat's composer, never out of the app, which
keeps the never-send line Slack and Gmail drafts already hold.

Polling on the heartbeat, not the app's websocket. Beeper's websocket is
marked experimental with no stated reconnect or backfill rules, and Outbox
looks every five minutes anyway. The sync keeps a cursor per chat, so a
wake-up from the websocket can be added later without redesign.

## Decisions taken (2026-09-16)

- Reply model: Sky drafts, the person sends in Beeper.
- Scope: the whole primary inbox, groups included; muted, low-priority,
  archived and read-only chats out; Slack accounts out.
- The first run reaches back thirty days. Outbox scans from its own range,
  so older captures feed the notebook without a burst of stale triage.
- Cards and files say the network. Beeper appears only as the app a draft
  is ready in.

## Left open

- Beeper's OAuth grant expires and cannot be refreshed. The Connections row
  says when a grant ran out; the exact lifetime is Beeper's to set.
- A Beeper label as an opt-in narrowing door, if the primary inbox proves
  too wide.
- Contact matching to people profiles from the phone numbers and handles
  Beeper knows.
