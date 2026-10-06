---
created: 2026-10-05
updated: 2026-10-05
---

# Working context and durable failures

A long document-collection chat could finish notebook queries and show no
reply. Two independent contracts failed together.

Append-only context delivery put newly retrieved documents at the front of
historical user messages. The request guard could refit the system notebook
segment and shorten tool results, but treated those retrieved prefixes as
untouchable user prose. Lowering the retrieval slider could not remove them.
A retrieval allowance is not a bound on the accumulated conversation.

The engine's capacity error reached the live stream and the host's thread
summary, but the session saved no failed assistant entry. Background plan
polling replaced the streamed error with the saved conversation, making the
failure disappear. Recovery lost the distinction for the same reason.

The working request now has an explicit source map, separate from the complete
provider history. Only an identified retrieval prefix can be compacted, using
its owner turn, character length, hash, and source paths. Legacy records require
the retrieval log and the exact original user suffix; guessing from marker text
could delete someone's quotation. Capacity fitting leaves headroom, then falls
back to the hard window for otherwise valid irreducible input. Compacted source
references and tool excerpts persist so a restart does not inflate every request
again. The complete history stays available for inspection.

A failure now belongs to an assistant entry even when its text is empty. The
session saves its error and partial reply through the normal recovery path.
Completed tool exchanges survive a failed explanation; unfinished calls do not.
This lets a continuation inspect a saved receipt before repeating an action.
Automatic capacity retries occur at the model boundary, so they never replay
the tools from earlier steps.

Tests exercise a long source history, capacity fitting after an action, restart
and retry with one execution, legacy boundary validation, and a real browser
through plan polling, reload, service recovery, and the retry control.
