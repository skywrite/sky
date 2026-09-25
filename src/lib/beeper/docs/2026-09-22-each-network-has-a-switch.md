---
created: 2026-09-22
updated: 2026-09-22
---

# Each network has a switch

## The problem

Connecting Beeper meant every network it carries was saved from the next
check on, and up to a month of each chat's history with it. That was fine
for one network chosen on purpose. It is not fine for the next one: an
iMessage account brings the texts the phone silenced from unknown senders,
and a Telegram account brings every group the person never opened. There
was no way to say "this network, not that one", and no way to see what a
check was about to do before it did it.

## What changed

- Every chat account Beeper carries has a rule, kept by Beeper's account
  id beside the capture's state: `save` and `groups`. A network seen for
  the first time waits, off, until the person switches it on. Groups are a
  second switch, off by default, so a new network brings one-to-one chats
  only.
- A network Sky was already saving when the rules arrived stays on, groups
  included. The upgrade changes nothing on its own.
- One function, `judgeChat`, decides every chat's fate and names the
  reason in the words the page shows. The capture and the new preview both
  ask it, so what the page says a check would do is what the check does.
- The capture remembers its last run: counts, what it left out and why,
  which networks were off.
- Beeper has a page of its own under Settings › Connections, the first
  connection to get one: status, a card per network with its switches, the
  last check, Check now, and "Show what a check would save", which lists
  every chat in Beeper's three piles with its verdict. The row on the
  Connections page reads "Saving Signal. iMessage is new and waits for
  you." and leads there.
- A third switch per network holds texts from unknown senders: a
  one-to-one chat from someone with no name in the contacts, never
  answered, is not saved but listed on the page as "Held for a look",
  with Save and Open in Beeper. This is the door the silenced texts from
  the phone come through once iMessage is connected; what Jev makes of
  the held pile is the next step.

## Why the rules live in the state file

`config.jsonc` holds preferences a person can read and edit by hand. These
rules key on Beeper's opaque account ids, change from the page, and mean
nothing without the capture's own state, so they sit next to it in
`state/beeper/sync.json`.

## Verified

- `bun test lib/beeper/` — the existing capture test with the WhatsApp rule
  seeded, a new test for the upgrade rule, the switch, the group rule and
  the remembered run, a test for the hold (a bare number held with no file
  and no cursor, a handle the person answered saved, Save pulling the held
  chat in), and the preview over three piles.
- `bun test service/handler/settings/` — the rule, preview and check routes
  over a scripted host.
- `SKY_BROWSER_TESTS=1 bun test service/handler/http-beeper-page-e2e_test.ts`
  — the page in a browser: the row leads there, a switch writes the rule
  and the groups switch wakes, Save takes a held sender off the list, the
  row's summary follows, the preview and Check now answer, and the page
  fits a phone.
