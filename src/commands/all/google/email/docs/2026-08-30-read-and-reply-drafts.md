---
created: 2026-08-30
updated: 2026-09-07
---

# Reading threads and drafting replies

"Read my email" and "draft a response" by voice needed data where the
commands had console tables, and a reply path where only fresh drafts
existed.

## The view returns what it shows

`google:email:inbox:view` now returns its threads (`threadId`, sender,
subject, date, snippet, message count, saved) beside the table it
prints. The threadId is the handle the other tools take.

One guard came with it: `getInboxThreads` label-syncs a thread's
messages as persistence hygiene for user buckets like `Sky/Follow` —
re-adding a **system** label would instead un-archive (INBOX) or mark
unread (UNREAD), so the sync now runs for user labels only, and INBOX /
UNREAD are honest read-only listings.

The view also returns the label's true totals from `labels.get` —
the numbers Gmail's own UI shows. A limited listing had been mistaken
for the total. "How many" answers come from `totals`, never from the
length of the listing.

## google:email:read

One thread, every message with sender, time, and body — `bodyText` when
the message has a plain part, stripped `bodyHtml` otherwise — clamped
at 4k chars per message and 24k per thread. Read-only.

## google:email:draft:reply

A reply is derived, not dictated: given a threadId, the command picks
the newest message not sent by the account itself (falling back to the
newest overall), addresses its sender, prefixes `Re:` exactly once, and
sets `In-Reply-To`/`References` from the thread's RFC Message-IDs —
`pickReplyTarget` in `draft/lib/replyTarget.ts`, pure and tested. The
draft files through `drafts.create` with the thread id, so Gmail shows
it inside the conversation. `--to`/`--cc` override the derived
recipients.

Like `draft:new`, it is draft-only by construction; sending stays a
human act in Gmail. Reply-draft verification checks the threadId,
`Re:` subject, recipient, and both RFC headers, then removes the draft
with `drafts.delete`.

Account resolution across the family is now
`interactive: Console && compositionDepth === 0` — a served or composed
call errors on ambiguity instead of hanging on a picker with no
terminal.
