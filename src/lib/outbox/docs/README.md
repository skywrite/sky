---
created: 2026-09-06
updated: 2026-09-08
---

# Outbox — decisions prepared from saved conversations

Outbox is the first **system automation**. `sky outbox:setup` installs an ordinary charter in `automations/outbox.md`: `kind: system`, `run: outbox:scan`, `every: 5m`. The existing automation scheduler supplies cadence, quiet hours, pausing, and run history. Setup is idempotent and preserves an existing charter's status and schedule. Slack follow checks and Gmail follow sync remain in the service heartbeat; they are not migrated by this feature. `kind` is a designation, not a second scheduler or a new privilege.

The worker checks a chosen **date and time range** in saved Slack and email messages. The browser's From/Through controls use minute precision, including both endpoint minutes in the wall-clock timestamps of the notebook messages. Check now saves that exact range in `outbox/search.md`; it survives reloads and midnight until explicitly changed. Today fills a new full-day range. Until a range is chosen, the default is the owner's current local day. Scheduled and manual checks read the same saved selection. Revision checks prevent another browser tab from silently replacing it.

Coverage is the existing captures, not every message in the connected accounts. Discovery inventories the notebook's message collections and caches source timestamps and thread identities in `sources.json`. Actual message headings take precedence over `when:` and the filing date, so a capture filed on another day can still match. An undated capture on a selected day is included conservatively; a partial-day selection exposes its uncertain time. Stable references survive notebook layout changes. Follow records, `previous:` links, and matching saved Slack thread identities supply earlier **and later** context. Later replies can resolve selected requests without introducing unrelated out-of-range asks. Merged follows have no automatic native destination.

## Finding responses and decisions

Check now runs the triage prompt, with one judgment and proposed reply per changed conversation using Fable 5.1 at high effort (`default-fable-5.1-high`, API model `claude-fable-5-1`). It receives the selected range and its triggering captures, the current local date, UTC check time, saved thread history, prior response state, bounded owner context from `journal/about-me.md`, and current writing rules. Routine responses arrive with the actual draft written. A consequential choice or missing fact produces the smallest useful question, a grounded recommendation, and concrete response options where appropriate. The model cannot substitute an empty reply for a `draft` result or insert an unsupported draft into a `decision` result. The exact model, disposition, and explanation are retained for every checked conversation, including ignored messages. Prompts use the shared prompt library and treat source messages as untrusted evidence.

Judgment follows authors and timestamps inside captured message bodies, since top-level sender metadata can describe the original message. An earlier owner question is not a final approval; a subsequent recommendation, scheduling choice, or substantive reply can still need the owner. Clear acknowledgments and completed or delegated matters stay quiet. Plausible unresolved owner requests with uncertain context are surfaced for review.

Production drafting uses the shared [writing voice](../../writingVoice/docs/README.md). Your voice and Settings → Writing Voice edit `me/voice/rules.md`, initially seeded from existing `outbox/preferences.md`. Saved edits and accepted revisions become individual examples with one question, two suggested reasons, and the owner's answer. Confirmed lessons improve later drafts and compact into the rules. Examples teach writing, never transferable facts or standing permission for commitments.

The check establishes the intended reply, then the shared writer applies the current voice before the draft reaches review. Reply composition and follow-ups use that writer too. Outbox judgment resolves through `model.ts`; writing and learning use their owning module's model adapter. The writing pass reads current rules and confirmed lessons, with bounded excerpts from relevant examples. Legacy callers without a writer retain the original single-call behavior.

## Files and concurrency

Decisions live in `outbox/items/<conversation-hash>.md`. The body is the current draft; frontmatter retains the situation, reasoning, questions, source snapshots, original draft, approved pairs, and native draft reference. Ordinary reads survive service restarts. Scanner metadata and locks live under the user-data state directory, scoped by notebook root. A damaged checkpoint is an error, not permission to reset the baseline and replay work.

One process owns a scan at a time, including a manually invoked scan. Each check covers the complete selected inventory, with up to four concurrent model calls. `scan-progress.json` records the actual range, progress, and an explanation for each result; failed reads, missing or excessive history, and uncertain message times prevent a complete status. A model's ignore result with incomplete context becomes a review decision. Successfully examined versions are reused with their explanations only when the range, model/profile, and review revision still match. Discovery notices changed linked history and later saved replies even when the original seed is unchanged. Metadata-only edits do not repeat model work. Pending decisions carry across dates and changes to the search range.

The first run of the corrected policy reassesses legacy ignored versions and drops the old-date backlog. It archives untouched, unreviewed conversation items created that day solely from earlier dates; edited and approved items retain their normal review lifecycle.

The range policy invalidates earlier cached judgments. A subsequent check can fill an untouched item with a reply even when its saved messages have not changed. Human-directed or edited drafts remain protected. Changing the model or effort reassesses untouched conversations, including previously ignored results. Changing the range reassesses closed conversations too: another request may already exist in the same unchanged capture but fall outside the previous selection.

`responseHistory` records explicit owner-reported sends with their wording and source version, and model-observed replies with a reference and exact captured quote. The scanner supplies this history, the legacy `delivery` record, and clearly labeled unsent draft state on reassessment. Approving a native draft is never evidence of sending. An unchanged recorded send stays quiet; later captured activity is evaluated for a new unanswered request. An observed reply can archive the old review only when its cited quote exists in the saved source. A new request reuses the conversation's stable item ID while retaining response history and clearing the old native-draft reference. The new reply requires its own approval. What Sky checked distinguishes already answered, ignored, preserved, and failed outcomes.

Short writes use an atomic replacement and a content revision checked under a separate lock. Model work does not hold the writer lock. Capture changes during drafting discard the obsolete proposal; an editor winning a write race keeps their words. An edited or native draft is retained and flagged stale when new messages arrive. A review that already refreshed a source is not invalidated again by a lagging scanner checkpoint.

## Human review and native handoff

`/outbox` lives in Sky's existing shell. Its list separates **Needs review** from **Ready in apps**, with a focused draft editor and source-message rail. Explicit approval stores the original/final pair before calling a native draft command. Approval checks the saved source version again and requires acknowledgement of new messages. A provider preflight refuses to overwrite an existing unrelated draft or edits made in the native app.

Items distinguish **Draft ready** from **Your decision**. Choosing a response option or entering a few words asks Sky to compose the reply locally. **Revise with Sky**, **Shorter**, and **Warmer** use the working text, including unsaved edits, plus the owner's direction and the conversation. A missing fact remains an explicit question instead of a placeholder or invented answer. The owner can also write manually. Generated text stays in review until the ordinary explicit native-draft approval.

`POST /item/:id/compose` checks revisions and source freshness before and after model work. It never calls provider draft APIs. A newer edit wins a race, new context invalidates an obsolete result, and generated text based on owner direction is retained by subsequent scans. Recent owner directions retain their date and source version, so answering a follow-up does not discard an earlier choice. Browser direction text stays with an unfinished edit, and a late response for an item cannot replace another item's open editor.

Check now returns HTTP 202 after a detached worker is registered in local state. The HTTP request holds automatic service reloads through range saving and worker registration, releasing the hold on both success and failure. The worker owns the manual automation, scan, and completion stamp. The browser polls progress, remains usable during the check, and reconnects to the same check after a page reload or service restart. Connection failures retain the last progress and retry automatically. Duplicate clicks and overlapping scheduler runs do not create a second producer. Only the actual worker stopping is reported as interrupted. The reusable [process-job contract](../../jobs/docs/README.md) explains the startup handoff and persisted results; the service never owns a worker cancellation signal. Completion counts remain visible after a reload, with expandable explanations under “What Sky checked.” The same summary is used by the CLI and automation ledger; failed or incomplete work is never described as a complete check. A paused automatic schedule still permits an explicit manual check.

Outbox’s native placement writes use the existing `slack:draft:reply` / `google:email:draft:reply` and their draft-update commands. Placement does not send. A confirmed native reference is required before a row becomes Ready. An interrupted or ambiguous write becomes `placement_unknown` and is never automatically retried; the user checks the app. A process killed during placement is detected on the next status read. Archive removes a row from Outbox without claiming the native draft was sent or deleting it.

The message scanner consumes saved Slack/email conversations and observes actual replies only after they appear in those captures. Approved replies can also produce the linked follow-ups described below. Chat/voice capture into the same queue remains a subsequent producer. Freshness is checked against saved captures; changes not yet captured by follow sync are outside that guarantee. The owner can use Record that I sent it before their native reply has been captured.

## Following through on an approved reply

After a confirmed native handoff, `followups.ts` uses the same Fable 5.1 high profile to read
the **final approved wording**, communication preferences, and the original
conversation. An explicit promise to ask or tell another named person produces
that person's actual draft. Merely mentioning someone, proposing a hypothetical,
describing completed work, or promising to read a document does not create an
Outbox item. The model must cite the commitment and name in the approved
reply. Quote matching tolerates typographic apostrophes, quotation marks, and line
wraps, then retains the actual span from the approved reply. Changed words remain
invalid. The ordinary revision/source checks and provider preflight still run
before native writes; follow-up validation cannot block the native handoff.

The parent stores the approved reply and conversation snapshot before placement.
Approval returns as soon as the app confirms its draft. A service-owned worker
then prepares each follow-up as its own **Needs review** item, with persistent
`pending`, `preparing`, `complete`, or `failed` state and a per-item process lock.
A status read resumes interrupted work from its approved snapshot. A failed model
call waits for an explicit **Retry follow-up drafts** action; this retry has no
native placement capability. This starts follow-through
at the existing approval boundary; it does not claim that the parent was sent.
`Record that I sent it` is also available for ordinary and copied messages. A sent
report can prepare follow-ups for a previously reviewed or manually sent reply;
it records owner evidence and never sends a message.

The child links back to the parent and retains the approved wording, exact
commitment, recipient, situation, and draft. Its editor supplies this context when
composing or revising. The original reply remains accessible after archive through
`GET /item/:id` and the item link. A new recipient never inherits the original
recipient's native destination or source messages. These proactive drafts remain
local for review and copy into the intended app until a destination is linked.

Intent IDs derive from the parent, approved source version, and recipient.
Repeating creation, reloading, and reporting a send reuse the same item, including
an edited or dismissed child. No model call holds the writer lock. A native
placement with an unknown result retains the approved context without starting
follow-up drafting.
A failed child write is recorded separately from the confirmed native result;
the next status read repairs missing children from the saved plan without another
model or native call. Recovery uses the approved snapshot even if new source
context or an unapproved revision has arrived since.

The browser shows **Saving your draft in Slack…** beside the approval action,
then confirms the native draft while follow-ups are being prepared. Errors appear
in the same action area, with the failed step named. Polling continues through
native placement and follow-up preparation, including after reload. Follow-up
metadata changes do not make an unchanged ready draft look like an editor conflict.
When follow-ups arrive, the confirmation names their recipients and the linked
buttons open the new items.

## Verification

The colocated tests cover strict date scope on every run, legacy checkpoint migration, complete checks exceeding five conversations, bounded concurrency, progress and skip explanations, changed history, deduplication, retries, capture/editor races, midnight carryover, explicit review, learning pairs, ambiguous native writes, checkpoint damage, and setup preserving a pause. Drafting tests exercise the real SDK adapter with a mock model, cached summary migration, owner directions, bounded examples, and composition races. HTTP tests exercise origin and payload checks with native writes stubbed. Browser regressions cover HTTP 202, progress, reload recovery, automatic draft creation, response-option composition, shortening unsaved edits, and explicit native handoff with synthetic conversations.

## Notes

- [2026-09-08 — Checks survive service restarts](2026-09-08-checks-survive-restarts.md).
- [2026-09-08 — Fixed search ranges and response memory](2026-09-08-search-ranges-and-responses.md).
- [2026-09-08 — Approval must not wait for follow-up drafting](2026-09-08-approval-before-followup-drafting.md).
- [2026-09-07 — Replies carry their follow-through](2026-09-07-replies-carry-follow-through.md).
- [2026-09-07 — Put the reply back in Outbox](2026-09-07-drafts-and-decisions.md).
- [2026-09-07 — Check now must cover today's conversations](2026-09-07-complete-today-check.md).
- [2026-09-06 — A quiet check still needs a result](2026-09-06-quiet-check-feedback.md).
- [2026-09-06 — Drafts must not outrun review](2026-09-06-drafts-must-not-outrun-review.md).
