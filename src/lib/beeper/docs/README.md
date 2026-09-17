---
created: 2026-09-16
updated: 2026-09-16
---

# Beeper — every chat on this Mac, saved as messages

Beeper Desktop keeps WhatsApp, iMessage, Signal, Telegram, Instagram,
LinkedIn and the rest behind one local API on this Mac. `lib/beeper/`
connects Sky to that app, saves its chats into the notebook the way Slack
and Gmail captures are saved, and lets Outbox place a reply into a chat's
composer. Nothing here reaches the network: the app answers on
`127.0.0.1:23373`, only while it is running.

## The pieces

- `client.ts` — the local API over plain fetch, with zod for the fields Sky
  reads. `BeeperError` names the three ways a call fails: `unavailable` (the
  app is closed), `unauthorized` (the grant is gone), `request`.
- `oauth.ts` — the sign-in. Sky registers itself as a public client on the
  spot (Beeper supports dynamic registration), opens Beeper's own approval
  page, and trades the code for a bearer token over PKCE, with the loopback
  receiver the Google adapter already has. Beeper issues no refresh token;
  the grant carries an expiry and a run-out grant means signing in again.
- `secrets.ts` — the grant in the OS keychain, one entry: `beeper/desktop`.
  A token made in Beeper under Settings → Integrations is accepted too.
- `text.ts` — Matrix HTML folded back into markdown. Plain text passes
  through untouched.
- `capture.ts` — the sync, below.

Commands: `sky beeper:auth` (connect, `--status`, `--token`, `--remove`)
and `sky beeper:inbox:sync` (the capture; `--days` bounds the first run).
The web's Settings → Connections page runs the same sign-in with a Connect
button and shows the networks Beeper carries.

## The capture

Every five minutes the service heartbeat runs `beeper:inbox:sync`. The run
asks Beeper which chats in the primary inbox moved since the last run, pulls
each chat's messages after the chat's saved cursor, and writes them into the
notebook:

- One file per chat per day under the day's `actions/messages/`, named
  `HH-MM_<network>_<who>_<summary>.md`, the same shape Gmail captures use:
  a `## YYYY-MM-DD HH:MM - **Name**` heading per message. Later messages
  the same day append to that file; a new day starts a new file with
  `previous:` pointing at the last one.
- Frontmatter: `from`, `to`, `when`, `medium` (the network's name, so a
  card reads WhatsApp, not Beeper), `summary`, `chat` and `account` (Beeper's
  ids, which Outbox keys on), `group: true` for group chats, `attachments`.
- Your own messages are saved with the rest, under your account's display
  name, so Outbox can see when you answered.
- Photos, files and voice notes are copied into the day's attachments
  folder and listed in the file; a voice note with a transcription keeps
  the transcript inline. Stickers and GIFs are named, not copied.
- The day file gets a Complete entry per new file, the way Slack captures
  add one. A day with no day file yet keeps the capture without an entry.

What stays out: muted, archived, low-priority and read-only chats (Beeper's
own notion of what matters), reactions, deleted and hidden messages, and
every Slack account, since agent-slack already captures Slack and a second
copy would duplicate each thread.

State lives in `state/beeper/sync.json`: the last run's instant, and per
chat its cursor, the ids of recent messages (so a re-run never writes a
message twice), and the day → file map. The first run reaches back thirty
days; a chat limit per run leaves the rest for the next tick.

## Outbox

Discovery admits a saved message when it carries `chat` and `account`,
whatever its `medium`, joins a chat's files across days by the chat id, and
names the desktop app as the destination: `target = { medium: 'Beeper',
account, chat, group? }`. Placement writes the approved reply into the
chat's composer through Beeper's draft endpoint. Beeper fills only an empty
composer, which is the safety Outbox wants: a draft the person typed there
is never replaced, and a draft Sky placed earlier is replaced only when its
words are still Sky's. Sending stays with the person in Beeper. Open in
Beeper brings the app forward on the chat.

## Verification

- Unit: `bun test lib/beeper/` (text, client, sign-in with a real loopback,
  and the capture against a scripted Beeper and a temporary notebook);
  `lib/outbox/sources_test.ts` for admission and joining;
  `service/handler/outbox/beeper_test.ts` for placement rules;
  `service/handler/settings/connections_test.ts` for the page's routes.
- Live: `sky beeper:auth --status` lists the networks; `sky beeper:inbox:sync
  --dry-run` shows what a run would save.

## Notes

- [2026-09-16 — Beeper brings the other chats in](2026-09-16-beeper-brings-the-other-chats-in.md).
