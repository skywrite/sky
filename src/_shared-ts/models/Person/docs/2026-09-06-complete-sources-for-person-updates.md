---
created: 2026-09-06
updated: 2026-09-06
---

# Complete sources for person updates

## The problem

Profile curation used the fast model and a chat packer built for topic
classification. It clipped user turns at 2,000 characters, assistant turns
at 1,200, and the assembled conversation at 48,000. A correction late in a
long message could disappear even when the model had ample context space.
Meeting curation saw a generated write-up rather than the corrected words.

The prompt also allowed recent events in Overview. Short-lived tasks could
displace identity, and an assistant's recommendation could become a profile
fact. Exact-line dedupe let paraphrases of existing prose accumulate.

A separate write flaw made more model context insufficient: after a model
read a profile, the applier read it again and applied the already-generated
replacement. A newer Overview could be erased without a conflict. If a
write did conflict, retrying the same replacement erased the newer section
then instead. The existing conflict test covered an independent field fill,
which is safe to retry, and missed the destructive case.

## The change

Person curation uses Sonnet through the balanced role. Chats provide full,
dated, role-labeled text; meetings provide the corrected transcript and
confirmed metadata. The source has one owner: the chat or meeting record.
Classifier and memory packing are unchanged. Oversized requests fail through
the model error log, without learning from a silently incomplete source.

The prompt distinguishes user evidence from assistant context, preserves
uncertainty and source dates, rejects temporary activity in profiles, and
asks for deduplication by meaning. These remain model judgments. A stronger
model does not turn them into mechanical guarantees.

The applier now carries the original profile text through generation and
write retries. If its Overview differs from the current one, that replacement
skips. Other operations can still apply. An unchanged Overview also skips,
so a redundant model response cannot churn the file and its update date.

## Verification

Synthetic tests preserve a late career correction beyond the former 48k
limit, including original message times and assistant context. Save tests
confirm that this full text reaches the person distiller. Writer tests cover
an Overview added during generation, an Overview changed during saving,
retry with and without an independent field fill, and an unchanged Overview.

No existing notebook profiles are rewritten by this change. Cleaning earlier
profile output remains separate from fixing future updates.
