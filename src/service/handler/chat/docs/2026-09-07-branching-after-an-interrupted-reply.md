---
created: 2026-09-07
updated: 2026-09-07
---

# Branching after an interrupted reply

A browser can retain an interrupted message and partial reply after the
service restores only completed exchanges. Sending again adds another pair
to that page. The old branch button derived its turn from the displayed
message index, so the third displayed reply could belong to the second
server exchange. The branch route rejected it as outside its turn range.
If the server subsequently acquired more turns, that same stale index could
silently select a different reply.

Completed replies now carry a service-issued `{ turn, key }` branch point.
Thread read-back supplies these points alongside its messages, and the
completed turn frame supplies the new reply's point. Failed replies have
none. The button and the branch markers use the server's turn number;
retained page-only messages can no longer shift them.

The key hashes the visible conversation through that reply, including its
message roles and timestamps. It normalizes whitespace and trailing Sources
lists because the transcript parser normalizes those during recovery. An
unchanged prefix keeps its key when more messages arrive or its snapshot is
read back. Identical reply text under a different question does not match.
The branch route verifies both the number and key before naming the parent
or creating a branch. Missing or changed history produces a recovery
message and leaves the current page intact. Older pages without a key are
directed to open the chat in another tab, preserving their displayed copy.

Clamping the requested turn would choose a different branch point. Replacing
the displayed conversation with a shorter server copy would discard the
only surviving partial text. Neither addresses reply identity. These
references protect branching without importing browser-only text into the
parent's saved history or changing the transcript format.

## Verified

- HTTP tests restore a real disk snapshot after an interrupted exchange,
  continue the chat, and branch from both the earlier reference and the
  second completed exchange. Heading spacing and source formatting survive
  the round trip.
- HTTP tests reject a changed prefix at an otherwise valid turn, an absent
  reply, an old page with no key, a missing thread, and a malformed index;
  refused requests create no branch and preserve the parent's history.
- A browser test closes the stream after partial text, follows the actual
  reconnect path to a shorter server history, and sends again. The page
  keeps all six displayed messages, offers two branch actions, and sends
  the second server reference for its third displayed reply. A conflict
  preserves the page; a successful attempt opens the inherited history.
