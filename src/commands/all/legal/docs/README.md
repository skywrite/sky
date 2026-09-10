---
created: 2026-08-09
updated: 2026-09-10
---

# Agreement review

`legal:review` reads original local PDFs and documents and returns material
findings to the conversation. `legal:annotate` is the separate, explicitly
requested Google Doc annotation workflow. Ordinary review must never compose
into the Google agent: the analysis model has no tools at all.

The direct workflow composes in `lib/legalReview/`. Its runtime is shared by
the command, web chat and terminal chat; the chat host supplies actual profile,
relationship, memory, retrieved notebook context and role-tagged conversation
through a trusted async-local envelope. Those facts are not model-authored
command arguments. The reviewer uses the established perspective and flags a
specific ambiguity only when it affects the conclusions.

## A related set across messages

A review has a stable ID and one Markdown record at
`time/<configured-day>/legal-reviews/<date>_<uuid>.md`. YAML `review` is its
structured source of truth; the readable body projects its document map,
findings and decisions. Original bytes are retained under the record's
companion `sources/` directory, named by content hash. They survive deletion
of an incoming file or closure of the chat. An explicit replacement preserves
the earlier version and removes it from the active set. Amendments remain
separate active documents. Identical uploads are idempotent.

Chat continuation metadata stores the review ID and the turn that linked it,
both in recovery snapshots and filed transcripts. A reply thread inherits
that reference when it starts after the linking turn. The reference points to
the current shared review, not a frozen historical assessment. New branches
before that turn have no review link. Current review state is injected into
each subsequent chat turn, including explicit decisions made in the summary.
Review discussion stays where it was requested; drafting can use the existing
reply-thread UI, with no automatic routing or nested threads.

`action=add` registers files without analysis; `action=status` reads the saved
record. The default action rereads all active originals and compares the set.
The expected count comes from the user's stated scope and is distinct from
the number supplied. A new source, replacement or changed focus invalidates
the prior comparison before model work begins. Failed analysis leaves the
record and earlier findings intact and visibly awaiting review.

Analysis streams its structured response with a fifteen-minute total deadline;
the provider's stream idle guard detects dead connections. The former four-minute
non-streaming deadline could abort a working multi-agreement review twice in one
chat turn. Partial response objects are never published as reviewed findings.
Only the complete schema- and evidence-validated result updates the record.

The trusted tool context is created once per user turn. The tool boundary uses
that identity to prevent concurrent analysis and further analysis after a failure,
even if the model changes the focus or selected documents. `status` and `add`
remain available, and another user turn can request a fresh attempt against the
same saved originals. The analysis call itself disables SDK retries. Failures
report the retained review ID, source count and earlier finding count; loading
five files is not completion of five reviews.

## Evidence and decisions

The structured response accounts for every active document, its coverage and
relationships, plus material findings and missing documents. Interaction
findings must cite both sides. The brief explicitly compares definitions,
obligations, amendments and precedence, distinguishing deliberate exceptions
from conflicts. It retains all eight coverage areas without surfacing cosmetic
wording changes. The reviewer has no legal research tools; material claims
about current law or enforceability remain explicit uncertainties.

Every finding includes source IDs, location, quotation, practical effect and
suggested next step. Text quotations are matched after whitespace normalization;
unmatched quotes remain unverified and prevent a current comparison. PDFs are
sent natively, and their citations are identified as model-read, not independently
text-verified. Partial/unreadable coverage stays visible. The current limits
are 20 MB of active originals and 500,000 converted text characters per set;
exceeding either fails without silently skipping or truncating agreements.

Prior finding IDs survive later reviews. An omitted finding stays open for
rechecking; it never silently disappears. AI assessments (including addressed)
and recommendations are distinct from the append-only user decision history.
Only the user-facing decision endpoint records accept-risk, ask-team, resolved
or reopen. The server supplies the user attribution and checks the displayed
revision. Decisions carry the finding content they were made against: changed
findings reopen for consideration without rewriting what the user decided.
Atomic writes and per-review locks protect persistence, and a changed revision
prevents an in-flight analysis from overwriting a newer document set.

## Optional Google annotation

`legal:annotate` retains the former Google workflow and its approval gate.
A local document is imported as a new Google Doc; a Google URL/id targets an
existing Doc. The command passes both `file` and `import` explicitly to avoid
parent-argument leakage in command composition. Its target argument remains
`document`, not the Google agent's `file` argument.

Annotation requires Chromium and the automation profile created by
`sky google:browser`. Findings use real anchored comments and concrete suggested
edits; document text is not directly edited. Browser failures leave unplaced
findings in the report, never downgraded to unanchored panel comments. Only the
whole-document summary belongs in the comments panel. See the
[Google agent design](../../google/agent/docs/README.md) for mission mechanics.

## Verification

Synthetic related agreements exercise incremental upload, native PDFs,
cross-document evidence, replacements, incomplete coverage, stale decisions,
no Google calls, recovery, filing and reply-thread inheritance. The browser
scenario covers the document map, source quotes, decision persistence, text
selection across polling, response threads and narrow layouts. Model responses
are scripted in automated tests; those checks establish workflow contracts,
not legal-review accuracy.
