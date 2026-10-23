---
created: 2026-10-20
updated: 2026-10-20
---

# iMessage names come from the Mac

## The problem

With iMessage connected in Beeper, every one of its chats reached Sky as a
number: the chat's title a formatted number, its participants carrying `id`,
`phoneNumber` and `email` and no name field at all. Over ninety days that
was a few hundred one-to-one chats, and the unknown-senders hold would have
held nearly every one — the person's real contacts along with the junk —
because the hold's test for "unknown" is "nobody has a name for them".

## What was ruled out

- **Beeper's Contacts permission.** It was granted. Beeper's own window
  resolves iMessage names from it, but the local API does not pass them on.
- **Beeper's contacts endpoints.** `GET /v1/accounts/{id}/contacts/list`
  returns a page of named contacts for Signal and for WhatsApp, and an empty
  list for iMessage; the search form of it finds nothing either. The
  iMessage bridge is a different kind (`local-imessage`, provider
  `platform-sdk`), absent from the bridges list, with no capabilities to ask.
- **Waiting for indexing.** Names on the other networks come from the
  network itself; iMessage has no such source. There was nothing to wait for.

## The fix

The Mac already has both halves. Its Contacts database names the handle,
and its Messages database carries the phone's own filing of every chat —
known, or filtered as an unknown sender. Read-only, those two resolved every
chat Beeper listed, and their split matched the phone's exactly. So
`lib/macMessages/` reads them, and the capture takes the lookup as `names`:
`unknownSender` asks it before calling anyone unknown, `counterpart` and
`senderOf` put the name on the file and the headings, and the preview shows
the name where Beeper shows a number. The owner's own side, which Beeper
also leaves nameless on iMessage, comes from `journal/about-me.md`.

The cost is one permission: Full Disk Access for the service's binary. The
row under Settings › Connections › Messages on this Mac says whether the
read works, names the binary, and opens the System Settings pane; the
iMessage card on Beeper's page points there while it does not. Until it
does, iMessage stays off and nothing is held or saved.

## Rejected

- **A direct iMessage reader instead of Beeper.** Beeper's Mac connection is
  the same plumbing — the Messages data plus Messages.app driven to send —
  and it already feeds the switches, the hold, the preview and Outbox's
  draft placement. Only the names were missing.
- **The notebook's people as the name source.** They carry no numbers today,
  and the phone's verdict was the signal that mattered most.
