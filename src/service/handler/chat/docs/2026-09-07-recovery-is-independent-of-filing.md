---
created: 2026-09-07
updated: 2026-09-07
---

# Recovery is independent of filing

The web host coupled "Not saved" to deleting each turn's recovery snapshot
and disabling the snapshot at message acceptance. Development restarts
therefore erased active conversations. A browser could keep displaying the
old exchanges while its next message created an empty server session under
the same thread id. Notebook retrieval still ran, so the model could know
about recent activity while having no memory of the conversation itself.

Recovery and filing now have separate lifetimes. Every active web thread
keeps a temporary snapshot, written as a turn starts and finishes and when
its settings change. "Not saved" controls the final transcript and learning;
Discard deletes the recovery copy. The picker explains that distinction.
The message includes whether it continues a conversation, so a missing
thread is refused before the model can answer with empty history.

The snapshot also needs more than visible user/assistant text. For example,
a tool can read an Atlas brief and report its contents without the final
reply repeating them. Restoring only "I read the brief" loses the evidence.
Snapshot-only `recovery` frontmatter therefore carries the complete model
message sequence, including tool calls, results, and provider metadata,
plus the reading budget and the host's model, filing choice, title, parent
thread, and saved-file identity. Old snapshots continue to restore from
their visible conversation and context log. Filed transcripts retain their
existing format and do not carry the runtime recovery payload.

The host uses its existing context log to restore the notebook universe.
Settings can be changed before a restored session starts; that snapshot
must retain the inherited model messages and context log even though the
notebook has not been reloaded yet. Snapshot writes are queued, and explicit
close waits for outstanding writes before deleting the file. An interrupted
message is removed from both visible and model histories and offered for
resend, keeping earlier tool exchanges intact.

This protects conversation continuity through routine restarts. A forced
restart or process failure can still interrupt the reply currently running;
the existing interruption UI handles that case. It cannot recreate tool
results or conversation turns already deleted by an older process.

## Verified

- Fresh HTTP hosts over real snapshot files retain the prior conversation,
  exact model messages (including a synthetic tool result and provider
  metadata), context universe, model, reading budget, and filing preference
  under both `saves` values.
- Another restart after changing settings before the restored session's
  first message retains its complete history. Discard removes recovery,
  files nothing, and the thread does not return in the next host.
- A browser continuation with no restorable thread is refused before
  session construction or model invocation.
- An interrupted snapshot drops only the pending user message from the
  model history, preserving the earlier tool call and result.
