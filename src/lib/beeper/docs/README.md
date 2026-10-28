---
created: 2026-09-16
updated: 2026-10-28
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
- `../macMessages/` — names for the senders Beeper shows by number alone,
  from this Mac's Contacts and Messages; the capture takes it as `names`.

Commands: `sky beeper:auth` (connect, `--status`, `--token`, `--remove`)
and `sky beeper:inbox:sync` (the capture; `--days` bounds the first run).
The web's Settings → Connections page runs the same sign-in with a Connect
button and shows the networks Beeper carries.

## The capture

Every minute the service heartbeat runs `beeper:inbox:sync`, so a message
the person sends is in the notebook within the minute. The run asks Beeper
which chats in the primary inbox moved since the last run, reads each such
chat newest-first down to what it has already shown (never `after` a cursor:
the 2026-10-20 note on iMessage paging), and writes the new messages into
the notebook:

- One file per chat per day under the day's `actions/messages/`, named
  `HH-MM_<network>_<who>_<summary>.md`, the same shape Gmail captures use:
  a `## YYYY-MM-DD HH:MM - **Name**` heading per message. Later messages
  the same day append to that file; a new day starts a new file with
  `previous:` pointing at the last one.
- Frontmatter: `from`, `to`, `when`, `medium` (the network's name, so a
  card reads WhatsApp, not Beeper), `summary`, `chat` and `account` (Beeper's
  ids, which Outbox keys on), `group: true` for group chats, `attachments`.
  `from` and `to` follow the day's first message.
  A one-to-one chat you open reads you → them; one they open reads them → you.
  A group's `from` is its first sender and its `to` the group.
- Your own messages are saved with the rest, so Outbox can see when you answered.
  On every network they carry the full name from `me/about.md`, never the network's profile name,
  because the day page and Outbox know you by that name.
  The profile name stands in only when `me/about.md` has none.
- Photos, files and voice notes are copied into the day's attachments
  folder and listed in the file. A voice note says so in its heading, after
  the name, with its length when ffprobe can measure the copy —
  `**Maya Okafor** (voice note, 0:42)` — and its day line starts with
  "Voice note:". It keeps its words inline:
  Beeper's transcription when it offers one (WhatsApp does), else the
  provider chosen under Settings → AI → Audio transcription listens to the
  copy during the sync, so nothing waits on the person; a voice note that
  could not be transcribed is listed by file name and the run says why. The
  words also name a message that has no text of its own. Stickers and GIFs
  are named, not copied. For iMessage, Beeper points at the Mac's own
  Messages library for every photo and voice note, which the service can
  read only with the Full Disk Access grant that names the senders
  (`../macMessages/docs/README.md`).
- The day file gets a Complete entry per new file, the way Slack captures
  add one. A missing day file is created as needed.

For iMessage, `lib/messageDayCategory.ts` chooses the entry's `Personal Complete` or `Professional Complete` section.
The same decision is used by `message:new` for iMessage text and audio imports unless a category was explicitly chosen.
Jev receives the owner's family context, profiles matched to the conversation's participants, and the conversation.
Relationships come first; ambiguous or mixed exchanges and unavailable classification default to Personal.
Professional requires clear business purpose with at least 85% probability.
The choice is only the entry's location in `day.md`: it adds no category field to either file.
Later appends keep the existing day entry and any manual section correction; sync does not sweep historical days.

What stays out: muted, archived, low-priority and read-only chats (Beeper's
own notion of what matters), reactions, deleted and hidden messages, automated
iMessage Screen Time request placeholders, and every Slack account, since
agent-slack already captures Slack and a second copy would duplicate each thread.
Screen Time placeholders are skipped individually; people's messages in the same chat still land.
Chat events on Signal and WhatsApp stay out too: a disappearing-message timer, someone leaving.
Beeper files them under a person's name, as if that person wrote them.
Those networks give every message a type and the events none, so an untyped message there is an event.
iMessage gives no message a type, so the rule does not apply to it.

## Each network has a switch

Since 2026-09-22 every chat account Beeper carries has a rule, kept by
Beeper's account id: `save` (new messages are saved) and `groups` (group
chats too). A network seen for the first time waits with both off until
the person switches it on under Settings › Connections › Beeper; a network
Sky was already saving when rules arrived stays on, groups included, so an
upgrade changes nothing. `judgeChat` is the one place that decides a chat's
fate — the capture and the page's preview both ask it — and its reasons are
the words the page shows: `Signal is off`, `groups are off for Signal`,
`read-only`, `muted`, `archived`, `low priority`. The capture reports the
first three chat by chat; Beeper's own filing stays quiet.

`preview.ts` is the page's "Show what a check would save": every chat in
Beeper's three piles from the last month, muted ones included, each with
its verdict and reason. It fetches no messages and writes nothing but the
rules for accounts it meets for the first time.

## Unknown senders are held

A third rule per network, `holdUnknown`, on for every network the person
switches on from now (off for a network Sky was already saving): a
one-to-one chat whose other side has no name in the contacts — Beeper
shows a number, an address or a handle instead (`unknownSender`) — and in
which the person never wrote is **held**: no file, no day entry, no cursor,
just an entry in the state's `held` map with the sender as Beeper names
them, the newest message's first line, its instant and a count. The page
lists them under "Held for a look" with Save (the chat's sender counts as
known from then on, `markKnown`, and a check runs at once, pulling the
month in) and Open in Beeper. Writing back yourself does the same
without the button. Held entries older than the backfill fall off. The
preview marks such chats `held: unknown sender`; it cannot see who wrote,
so a chat the person answered reads as held there and is saved by the
check.

Who a sender is, on every network, is settled in one order (`senders.ts`):
the notebook's own people records first, by the number or address their
`email:` and `phone:` fields carry — that name is the one the notebook uses
for the person, whatever the phone calls them, and it outranks the name the
messenger shows; then this Mac's Contacts and Messages (`lib/macMessages/`),
whose cards can also lead to a record through an address they share with it;
then the messenger's own name; then the handle. iMessage is the one network
Beeper shows by number alone — no name on a participant, no contacts for the
account (the 2026-10-20 note below) — so for it the lookup is the only
source of names: a number Contacts can name, or one the phone itself files
as known, is not unknown, and the name goes on the file, the headings and
`from:`. Unnamed groups whose titles list phone numbers or email addresses
resolve each handle through the same lookup for `to:`, filenames, day entries and previews.
Unknown handles remain visible, and custom group titles are preserved.
The owner's side comes from `me/about.md`. Without the
lookup — the service lacking Full Disk Access — every iMessage sender would
be held, and the network's card says so.

State lives in `state/beeper/sync.json`: the last run's instant, the rules
above, the held chats, the last run itself (counts, what it left out and
why, which networks were off) for the page, and per chat the instant of the
newest message it has shown (the next run looks from an hour before it), the
ids of recent messages (so a re-run never writes a message twice), `known`
once the person said Save, and the day → file map. The first run reaches back seven days (2026-10-20: a month of old texts was too much; `--days` widens it); a chat limit per run
leaves the rest for the next tick.

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
  the capture against a scripted Beeper and a temporary notebook, the
  rules, the hold and the preview); `lib/outbox/sources_test.ts` for
  admission and joining; `service/handler/outbox/beeper_test.ts` for
  placement rules; `service/handler/settings/connections_test.ts` for the
  routes.
- Browser: `SKY_BROWSER_TESTS=1 bun test service/handler/http-beeper-page-e2e_test.ts`
  walks the page over a scripted host; `SKY_BEEPER_SCREENSHOTS=<dir>`
  keeps captures.
- Live: `sky beeper:auth --status` lists the networks; `sky beeper:inbox:sync
  --dry-run` shows what a run would save.

## Notes

- [2026-10-20 — Beeper pages iMessage only forward](2026-10-20-beeper-pages-imessage-only-forward.md).
- [2026-10-20 — iMessage names come from the Mac](2026-10-20-imessage-names-come-from-the-mac.md).
- [2026-09-22 — Each network has a switch](2026-09-22-each-network-has-a-switch.md).
- [2026-09-16 — Beeper brings the other chats in](2026-09-16-beeper-brings-the-other-chats-in.md).
