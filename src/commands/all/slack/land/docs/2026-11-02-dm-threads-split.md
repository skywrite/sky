---
created: 2026-11-02
updated: 2026-11-02
---

# A direct message day split into one document per thread

## What was wrong

A direct conversation with threads showed up on its day as several entries.
Say Jane Doe writes "Morning", then "Quick question on Atlas?", then a longer
note, and the owner answers the second and third in threads.
The day got the conversation's own document, which stopped at the last
top-level message.
Beside it sat one thread capture per thread, each repeating its root and
carrying the replies.
Every landing since the landings began did this to direct and group
conversations with threads.

## Why

Two gaps lined up.

Slack's Activity view reports a reply inside a direct conversation as
`thread_v2` (and a mention in one as `at_user`), not as `dm`.
The `dm` entry moves with top-level messages only.
The plan sent every entry that was not `dm` to `slack:follow:message
--landing` without asking what kind of conversation it sat in.
That made a follow and a thread capture for each thread.

The conversation's own pass read the history newer than its cursor and the
threads of roots in that window.
A reply under a root that had already landed never appears in that history,
so the day's document never got it, even when the pass ran.

## What was rejected

Re-reading a window of history on every pass, as the channel cache does
(its last two days), to spot roots whose `latest_reply` moved.
The conversation's pass only runs when activity names the conversation, and
for a thread reply that activity is the `thread_v2` entry, which already
names the thread at any age.
A window would cost reads on every pass and still miss roots older than it.

Keeping the thread captures and leaving those messages out of the day's
document.
That splits one conversation across documents, against the ruling of one
document per conversation per day.

## The fix

The plan asks each entry's conversation kind first.
In a direct or group conversation, every entry lands with the conversation,
and names its thread root; so does an own reply found by search, through the
`thread_ts` of its permalink.
The conversation's read takes those roots and reads each thread, keeping
only messages newer than the cursor: an older root was landed with its own
day, and that day is not rewritten.
A named thread whose root was deleted answers `thread_not_found`.
It is skipped, so it cannot hold the feed cursor in place forever.

## Repair

The follows the landing had made inside direct and group conversations were
closed, since their threads now land with the conversation.
The thread captures already written were folded back into their day's
document with `mergeSlackConversations`, and the absorbed files were kept
aside in the state area rather than deleted.
Two things that merge does not do had to be handled on the way.
It orders messages by their minute only, so same-minute messages from
different files were put back in Slack's order by their anchor ts.
And a message edited in Slack after one capture differs between the two
copies, which the merge refuses; the copy matching Slack's current text
was kept.
