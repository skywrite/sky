---
created: 2026-09-07
updated: 2026-09-07
---

# Replies carry their follow-through

A reply could say "I'll ask Jane to share the update" while leaving the owner
to remember, open another conversation, and write that request. Outbox prepared
the reply but dropped the work it created.

The approval path now analyzes the final chosen words and prepares a separate
message for each named communication commitment. Doing this at approval matters:
the owner may remove the promise or name a different colleague while editing.
The earlier AI draft cannot authorize the follow-up.

The original native draft and local follow-up are separate effects. The plan and
approved context are persisted before native placement. Only a confirmed handoff
or explicit owner report releases the follow-up. Recovery can then finish missing
local writes without repeating the native call. A follow-up write failure never
turns a confirmed native placement into an ambiguous one.

The new message starts in review with a link to the original reply, its own
recipient, and a concise draft. The source conversation's target belongs to its
original recipient and cannot be copied to the new one. A proactive item without
a verified native destination stays local and supports copying and a sent report.
Approving a draft is still distinct from sending it; automatic sent observation
is not part of this change.

Tests cover edited final wording, no-commitment replies, duplicate recovery,
partial persistence failure, uncertain native placement, editor/source races,
grounding, and repeated sent reports. Browser coverage exercises the new item,
editing and reload, and the archived parent link. Synthetic Opus checks also
cover personal work, negated requests, completed actions, and hypotheticals.
