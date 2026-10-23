---
created: 2026-10-20
updated: 2026-10-20
---

# Slack landings

`sky slack:land` is the "me" tier of Slack in Sky, ruled 2026-10-16 beside
the [channel cache](../../pull/docs/README.md): what Slack addressed to the
owner lands in the day directory on its own, as the conversation documents a
Slack capture writes. Every channel the owner is in goes to the cache under
`state/`; this pass is only about the conversations with them in it.

## What lands, and how it is found

Slack's own Activity view (`activity.feed`, through the fork's
`agent-slack activity list --refs-only`) lists what happened to the owner: a
mention (`at_user`, a keyword), new replies in a thread they are in
(`thread_v2`), a direct or group conversation that moved (`dm`, one entry per
conversation). Group pings (@channel, @here, a user group) are not a mention
of them and stay out. The owner's own messages do not appear in the view, so
they come from Slack search (`search messages "" --user <me>`), which names
each message's conversation and permalink.

The For you rules under Settings › Connections › Slack choose the kinds:
`slack.forYou.dms`, `slack.forYou.mentions` (mentions and thread replies
together) and `slack.forYou.own` in `config.jsonc`, all on by default, read
fresh on every pass. Reactions and bot DMs are not landed.

## How each kind lands

A thread (a mention, a reply in the owner's thread, an own message in a
channel) goes through `slack:follow:message --landing`: the thread is
captured whole with its summary, tags and rel, a follow keeps landing its
later replies with the follow check's backoff and expiry, and the follow
ledger is the identity, so a thread already captured by hand is brought up
to date rather than copied. `--landing` sets `landed: true` on the follow;
captures of a landed follow, now and on later days, write no capture log
line into the day file, because the day file stays prose (ruling 5) and chat
reads it every turn. Captures made by a gesture keep their line.

A direct or group conversation has no root to poll, so it keeps its own
record under `state/slack/dms/<id>.yaml`: Sky's cursor into it and the day
documents written. New messages (threads inside included) are landed the way
a follow lands replies, through the same `syncSlackFollow`: one document per
notebook day, appended to on later passes, earlier days never rewritten. Each
day's document gets its own summary; `to` is the other people, or the owner
when one of them wrote.

## Cursors and failures

`state/slack/land.yaml` holds the newest activity `feed_ts` handled, the
newest own-message `ts` seen, and the last few passes. The first pass looks
`--backfill-days` back (seven by default, ruling 2). A failure holds the
cursor just before the entry that failed, so the next pass tries it again;
everything after it was handled already and answers "known" the second time,
which costs a poll and nothing else. Conversations advance their own record
only when their landing succeeded.

## Left out

Reactions to the owner's messages, bot DMs, and group pings. A reply in a
thread the owner is not in is the cache's business, not a landing. The day
page lists landed documents as it lists any Slack capture; the rail section
the design names for them is not built yet.
