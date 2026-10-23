---
created: 2026-10-20
updated: 2026-10-20
---

# Messages on this Mac — the names behind the numbers

Beeper's iMessage shows every sender as a number or an address and nothing
else: its API carries no name on an iMessage participant and lists no
contacts for the account, while Signal and WhatsApp arrive with both (the
finding is in `lib/beeper/docs/2026-10-20-imessage-names-come-from-the-mac.md`).
The Mac has what Beeper withholds. `lib/macMessages/` reads two of its
databases, read-only, and answers one question per handle: what is this
person's name, and does the phone treat them as known?

## The two sources

- **Contacts** — `~/Library/Application Support/AddressBook/AddressBook-v22.abcddb`,
  the local book, and `Sources/<id>/AddressBook-v22.abcddb`, one per account
  (iCloud, Google, Exchange). Tables: `ZABCDRECORD` (first name, last name,
  organization), `ZABCDPHONENUMBER` (`ZFULLNUMBER`, `ZOWNER` → the record),
  `ZABCDEMAILADDRESS` (`ZADDRESS`). The cards of all the databases are
  joined into people — two cards that share a number or an address are one
  person — and a person's name comes from the card that names them best: a
  first and a last name, else an organization, else a first name alone; the
  largest database wins a tie. The databases come in no meaningful order,
  and a side copy may hold a bare "Mom" for a number the main database keeps
  under a full name (2026-10-20: a chat was filed under Mom that way). The
  answer also carries every number and address the joined cards hold, so a
  caller can follow a number to an address and on to a notebook record
  (`lib/beeper/senders.ts`).
- **Messages** — `~/Library/Messages/chat.db`, table `chat`: `chat_identifier`
  is the handle, `style` 45 a one-to-one chat (43 a group), `is_filtered`
  Messages' own unknown-senders filing — 0 known, 1 and 2 filtered. That is
  the phone's verdict, synced over Messages in iCloud: in Contacts or
  answered reads as known. A number with an SMS chat and an iMessage chat
  is known when either is. No message text is read, ever.

## Handles

One key per handle, `handleKey`: an address lower-cased; a number as its
digits, a leading North American country code dropped, because Contacts
often stores `(555) 010-2277` where Messages writes `+15550102277`. Other
countries keep every digit, so a card stored without its country code does
not match — a known limit.

## Permission

Both files sit behind Full Disk Access, and whichever program opens them
needs the grant: the terminal when `sky beeper:inbox:sync` runs by hand, the
service's binary (`bun`, the `binary` field of the status) for the heartbeat
and the page. Without it the open fails and the source reads as `denied`.
`missing` means the file is not there (no Messages on this Mac); `unexpected`
that it is there but not in the shape above, which is what a macOS release
changing its tables would look like. The row under Settings › Connections ›
Messages on this Mac says which, names the binary to add, and opens the
System Settings pane.

The grant covers more than names: Beeper points at the Mac's own Messages
library (`~/Library/Messages/Attachments/…`) for every iMessage photo and
voice note, so without it the capture lists them by file name and cannot
copy or transcribe them.

The entry to add is bun's own binary, the `binary` field, and it works for a
bun that launchd started directly as much as for one started under a shell
script: verified 2026-10-20 with two transient LaunchAgents (launchd → bun,
and launchd → bash → bun as a child), both reading the files once bun was in
the list. A process that was already running when the entry was added may
read `denied` until it starts again; after a Check again that still says so,
the row offers Restart Sky, which asks the service to start over and waits
for it to come back.

## Who asks

`openMacSenderLookup()` gives a lookup when at least one source could be
read, else null. The Beeper capture and preview take it as `names`
(`SenderNames` in `lib/beeper/capture.ts`): a sender Beeper shows by number
is not unknown when Contacts names them or the phone filed them as known,
and the name goes on the file, the headings and the `from:` line. Nothing
else reads these databases.

## What it is not

- Not a sync: no contact lands in the notebook's people, no message is read.
- Not a Beeper replacement: Beeper still carries the messages, the cursors,
  the drafts and Open in Beeper.
- Not Add to Contacts: that needs the Contacts app, a later step.

## Verification

- `bun test lib/macMessages/` — temporary databases in the real shape: a
  handle written three ways, the phone's verdict, a sealed file (`denied`),
  a missing one, an empty one (`unexpected`).
- `bun test lib/beeper/` — the capture and the preview over a scripted lookup.
- `bun test service/handler/settings/connections_test.ts` — the routes.
- Live: `GET /settings/_api/connections/mac-messages` on the service.
