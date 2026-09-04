---
created: 2026-09-03
updated: 2026-09-03
---

# A chat you do not keep

## What happened

A web thread had one way out: the end action saved it — the transcript
filed under the day's chats, the save-time distillers run on it. The route
behind that action already accepted a no-save flag, but nothing on the page
sent it. The terminal had both halves for a while: `-E` starts a chat
ephemeral, Ctrl+S or `/nosave` turns saving off mid-chat. Asked for on the
web: an incognito start, or a way to decide later that this one is not
kept.

## What changed

One switch covers both. `Saves to today ▾` joins the model and the reading
budget under the composer, with two stops: saves to today, or not saved.
Set before the first message it is an incognito chat; it can change until
the thread is closed. The end button reads `Save & close` on a thread that
saves and `Discard` on one that does not. The day's list marks a thread
that is not kept with "not saved".

- The setting travels with the model and the budget: `saves` on
  `GET /chat/:id/settings`, `{ saves: true | false }` on the POST, kept as a
  pref for a thread not yet built and on the thread once it is. A change
  mid-turn is refused like the others. The end route uses the thread's
  setting unless the caller says `save` outright.
- Not saved means nothing of the thread rests on disk. The session still
  writes its crash copy as each turn ends — that path stays the other
  lane's — and the routes remove it right after, through the host's
  `snapshotPath`; turning the setting off removes the copy at once, turning
  it on again lets the next turn write one. With no copy to come back from,
  such a thread does not survive a restart, and the list of restored
  threads never shows it.
- A discarded thread ends with `saved: null`: no transcript, no day entry,
  no memory or person facts. The page says "Discarded — nothing kept".

## What it is not

It is not a private mode for the model or the tools: what the thread reads
and does happens as in any other thread. It decides only what stays behind.
