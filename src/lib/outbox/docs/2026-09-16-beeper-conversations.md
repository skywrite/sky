---
created: 2026-09-16
updated: 2026-09-16
---

# Chats from Beeper join the queue

## What changed

Discovery admitted only Slack and email. A saved message now also counts
when it carries Beeper's `chat:` and `account:` ids, whatever network its
`medium:` names. Such files join into one conversation by the chat id, the
way Slack threads join by their link, so yesterday's file and today's read
as one exchange without a follow record. The conversation's `medium` is
the network (WhatsApp, iMessage, Signal…), so the model, the writing voice
and the cards all see the real channel; the target is the desktop app.

## Placement

A Beeper target places the approved reply into the chat's composer through
the app's draft endpoint. Beeper fills only an empty composer: a draft the
person typed there refuses placement with the same words the Slack and
Gmail checks use, and a draft Sky placed earlier is replaced only when the
composer still holds Sky's wording. Open in Beeper is a request to the
service, since the app has no link Sky can hand the browser; the page shows
it beside the other actions.

## Detection

Nothing new. The sync saves the owner's own messages too, so the scanner's
`captured_reply` evidence works exactly as it does for Slack and email: the
reply appears in the next capture, and the item reads Answered.

## Trades

The `medium` field of a conversation is a free string now, not the two-name
enum. Every consumer already branched on `'Slack'`/`'Email'` with a plain
fallback; the prompts name chat conversations beside Slack and email.
