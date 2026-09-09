---
created: 2026-09-07
updated: 2026-09-07
---

# Check now must cover today's conversations

The first scanner treated the date as an initial baseline, then accepted changed
files from any date. A click also processed only five conversations. An older
request could appear as current while unanswered requests saved today remained
queued. Ignored versions had no persisted explanation, making omissions hard to
diagnose.

Discovery now enumerates today's directory on every run and reads older files
only as linked context. One check processes the whole inventory with bounded
concurrency, checkpointed progress, and a reason for every decision or omission.
Legacy ignored versions are reassessed, and untouched old-only items mistakenly
created that day are archived. Existing human edits and workstream items remain
protected.

The HTTP request starts a service-owned background job. Keeping the browser
request open for an entire day's model calls would expose it to connection
timeouts and make a reload lose visible progress. HTTP 202 plus persisted progress
lets the user continue reviewing while the check finishes. A partial failure
remains explicitly incomplete and retryable.

Coverage alone does not guarantee useful judgment. Captured bodies contain the
actual speakers and chronology; top-level sender metadata can be stale. For
example, an owner can ask for a recommendation, receive one, and still owe a
decision. The triage prompt gets the current date and distinguishes this from a
completed exchange. It prioritizes finding unresolved responses, with reply
composition deferred. Synthetic regression tests cover the queue, date, progress,
retry, and browser lifecycle; model judgments still require inspection of the
recorded explanations against the source conversations.
