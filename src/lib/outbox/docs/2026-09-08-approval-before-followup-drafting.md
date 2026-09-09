---
created: 2026-09-08
updated: 2026-09-08
---

# Approval must not wait for follow-up drafting

The first follow-up implementation ran a model and validated its quoted
commitment before placing an approved native draft. A model error or a quote
that changed an apostrophe could therefore block an otherwise valid handoff.
The browser displayed errors above the whole editor, outside the visible area
when the person was clicking the approval button.

Approval now performs the source checks and provider preflight, persists the
exact approved reply and conversation snapshot, and places the native draft.
It returns the confirmed result before follow-up model work starts. Pending
follow-up work survives a restart; one worker per item owns it under a process
lock. Model failure is separate from native placement and has an explicit retry
that cannot place the parent draft again. Existing child drafts and human edits
remain authoritative on recovery.

Quoted evidence tolerates typographic quotes and whitespace only, and maps back
to the actual approved text. This does not permit changed recipients, negations,
or requests to be accepted as the original commitment.

The action area shows saving, confirmed native placement, follow-up progress,
and errors. Polling observes background preparation through reload. Background
metadata updates do not force another review of an unchanged ready draft.

Regressions cover a held model call after native confirmation, independent
follow-up failure and retry, process-lock deduplication, original-context
recovery, typography matching, visible browser errors, progress through reload,
and creation of the linked child without a second native write. A live read-only
Slack preflight also passed during diagnosis; no live draft was placed by these
checks.
