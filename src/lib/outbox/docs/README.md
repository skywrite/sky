---
created: 2026-09-06
updated: 2026-09-22
---

# Outbox — decisions prepared from saved conversations

Slack message timestamps use the shared [Slack conversation parser](../../../_shared-ts/models/Message/slack/docs/README.md).

The connection from objectives and workstreams into Outbox review and back to recorded work is implemented by `lib/workstreams/outbox.ts` and described in the [workstream design](../../../../docs/topics/workstreams/README.md). The scanner continues to discover saved conversations; workstream execution can also prepare a local communication in the same Outbox.

Outbox is the first **system automation**. `sky outbox:setup` installs an ordinary charter in `automations/outbox.md`: `kind: system`, `run: outbox:scan`, `every: 5m`. The existing automation scheduler supplies cadence, quiet hours, pausing, and run history. Setup is idempotent and preserves an existing charter's status and schedule. Slack follow checks and Gmail follow sync remain in the service heartbeat; they are not migrated by this feature. `kind` is a designation, not a second scheduler or a new privilege.

The worker checks a chosen **date and time range** in saved Slack and email messages. The browser's From/Through controls use minute precision, including both endpoint minutes in the wall-clock timestamps of the notebook messages. Check now saves that exact range in the Outbox state directory's `search.md`; it survives reloads and midnight until explicitly changed. Today fills a new full-day range. Until a range is chosen, the default is the owner's current local day. Scheduled and manual checks read the same saved selection. Revision checks prevent another browser tab from silently replacing it.

Coverage is the existing captures, not every message in the connected accounts. Discovery inventories the notebook's message collections and caches source timestamps and thread identities in `sources.json`. Actual message headings take precedence over `when:` and the filing date, so a capture filed on another day can still match. An undated capture on a selected day is included conservatively; a partial-day selection exposes its uncertain time. Stable references survive notebook layout changes. Follow records, `previous:` links, and matching saved Slack thread identities supply earlier **and later** context. Later replies can resolve selected requests without introducing unrelated out-of-range asks. Merged follows have no automatic native destination.

## Finding responses and decisions

`conversationScreen.ts` asks TypeSafe's Jev before request extraction, using the existing attention prompt, owner profile, active initiatives, current local date, and the complete linked conversation. Five independent questions cover the four ownership bases below and ambiguous context. Only when every probability is below 0.2 does the scan skip extraction and drafting. A possible obligation or uncertain answer continues through the full evidence-based pipeline. A missing TypeSafe key, invalid answer, or provider failure also falls back; the call has a three-second timeout with no retries, and a failed provider is bypassed for the rest of that check.

The screen never replaces an existing request ledger, even when its requests were previously resolved or archived: later replies must still be reconciled and can reopen an ask. Human review state and legacy items also bypass it. Missing history, an unidentified owner, or context exceeding the bounded input size uses the full reader rather than screening a truncated thread. Validated screen receipts live under `analysis/<conversation-hash>/screens/`; their fingerprints include all supplied evidence, policy, model selector, owner context, initiatives and local date, independently of the selected range. A screened result records zero extraction units and retains Jev's model, probabilities and duration in `requestAnalysis.screen`; it is a relevance judgment, not proof of an inventoried or resolved request. Source and item revision checks still gate publication.

Check now accounts for individual requests before preparing one proposed reply per changed conversation, using the Outbox model profile in `model.ts`. Extraction inventories potential owner requests; reconciliation matches answers, withdrawals, and changed requirements to each ask. These passes receive the complete linked history in bounded portions and owner context from `journal/about-me.md`, independently of the selected range. Range selection then uses each request's actual origin time. An existing active review carries its outstanding requests across range changes. Thus widening from four hours to seven days can select more requests and conversations without enlarging the reading unit or diluting an overlapping request's context.

An open or uncertain request is only a candidate. `requestAttention.ts` separately requires evidence that the owner personally owes a useful communication now: a direct ask, substantive participation in this exchange, an explicit promise to communicate, or a specific decision assigned through declared active project/workstream context. Following a channel, sharing an employer, or being able to help establishes no obligation. Unproven ownership stays out of review; it must never become a question about whether to volunteer, intervene, or nudge another person. A contingent approval waits until the other person's prerequisite arrives. The ledger retains these `none` and `waiting` assessments for later reconsideration.

An earlier scanner result without that assessment belongs in `awaitingCheck`, separate from the report's confirmed `items`, until the scan reaches it. This separation is a view of saved state, not a dismissal or deletion. Otherwise a long rescan would keep presenting the old unverified questions as fresh owner decisions. Human-edited, approved, workstream and follow-up drafts retain their normal lifecycle. Cards use a separate short semantic `summary`; the full situation, decisions and evidence remain inside the review. Older count-only titles fall back to the captured conversation's subject.

Each selected request that passes attention gets its own grounded reply plan. Routine answers combine into a single reply; any missing consequential choice keeps the complete response in decision review with the unanswered questions retained. Plans must acknowledge every selected request exactly once. A separate bounded brief gives each review a concrete subject, a short card summary and a coherent situation, while preserving the full plans underneath. The shared writer applies current writing rules and confirmed examples, followed by a coverage check against each planned answer. If polishing drops or changes an answer, Outbox keeps the complete grounded paragraphs. Prompts use the shared prompt library and treat source messages as untrusted evidence. The current local date informs attention and reply planning, while extraction and reconciliation remain independent of the scan clock.

The model-facing judgment schema asks for `explanation`, described as a brief user-facing explanation of the outcome. Adapters map it to the existing `reasoning` field in decision records. A harmless synthetic revision reproduced an empty refusal from Fable with the structured field named `reasoning`; the same request succeeded with `explanation`. Keep the wire field and its user-facing purpose explicit rather than exposing the storage name in structured output. This does not change the stored format or source and approval checks.

Judgment follows authors and timestamps inside captured message bodies, since top-level sender metadata can describe the original message. An earlier owner question is not a final approval; a subsequent recommendation, scheduling choice, or substantive reply can still need the owner. Clear acknowledgments and completed or delegated matters stay quiet. Uncertainty about the answer to a verified personal ask can need a decision; uncertainty about whether the ask belongs to the owner cannot.

Production drafting uses the shared [writing voice](../../writingVoice/docs/README.md). Your voice and Settings → Writing Voice edit `me/voice/rules.md`, initially seeded from existing Outbox `preferences.md`, including after its migration into data state. Saved edits and accepted revisions are learned from on the reply's own draft record, with one question, two suggested reasons, and the owner's answer. Confirmed lessons improve later drafts and compact into the rules. Edits teach writing, never transferable facts or standing permission for commitments.

The check establishes the intended reply, then the shared writer applies the current voice before the draft reaches review. Reply composition and follow-ups use that writer too. Outbox judgment resolves through `model.ts`; writing and learning use their owning module's model adapter. The writing pass reads current rules and confirmed lessons, with bounded excerpts from relevant examples. Legacy callers without a writer retain the original single-call behavior.

## Files and concurrency

All Outbox-owned records live under `<userDataDir>/state/outbox/<notebook-key>/`, where the notebook key remains the first 16 hex characters of the SHA-256 of `DIR_BASE`. Decisions are `items/<id>.md`, in either id shape described under "Human review and native handoff"; `search.md`, legacy `preferences.md`, scanner JSON, worker jobs, and locks share that root. This directory contains durable human state: dismissals, owner directions, review history, recorded sends, native draft references, and follow-up relationships. Include it in backups and notebook moves; it must not be cleared as a disposable cache. A damaged checkpoint is an error, not permission to reset the baseline and replay work.

Decision frontmatter retains the situation, reasoning, questions, source snapshots, original draft, approved pairs, and native draft reference. Once the owner has used a reply, `draftId` and the Markdown body link to the canonical notebook `me/voice/drafts/<id>.md` record. Until then the item's body holds the words itself and no notebook file exists; opening an item never creates one. A link whose file the owner deleted falls back to the last approved wording, or Sky's original, and is dropped at the next write. The [shared draft contract](../../writingVoice/docs/README.md#shared-drafts-in-chat-and-outbox) owns naming, history, editing, learning, and concurrency with chat. Source messages, automation charters, and shared writing records keep their notebook owners.

`storage.ts` migrates the former notebook `outbox/` on first access, including an edit from a shared draft discussion. It acquires the existing scan and writer locks, checks every destination for conflicting content, publishes complete copies, verifies them, then removes the originals and empty directories. Identical partial copies resume after interruption; different copies stop migration without overwriting either. Unknown files and frontmatter are retained. Only a shared draft's physical Markdown backlink needs rewriting. IDs, shared draft records, and the existing scan/worker namespace are preserved. Normal scanning initializes storage before acquiring its scan lock.

One process owns a scan at a time, including a manually invoked scan. Each check covers the complete selected inventory, with up to four concurrent model calls. `scan-progress.json` records the actual range, progress, and an explanation for each result; failed reads, missing history, and uncertain message times prevent a complete status. In the request pipeline, missing history remains a coverage limitation without manufacturing an owner obligation. Successfully examined versions are reused with their explanations only when the range, model/profile, and review revision still match. Discovery notices changed linked history and later saved replies even when the original seed is unchanged. Metadata-only edits do not repeat model work. Pending decisions carry across dates and changes to the search range.

Saved conversations retain their complete source bodies, including large individual captures. Size bounds belong at the model boundary in `history.ts`, never in the canonical evidence used for freshness checks, review, and reply verification. Source portions contain at most 60,000 serialized characters, ordered by message time rather than filing date. Message boundaries are preserved where possible; oversized messages continue across excerpts with their original references, spans, and headings. Every source character is retained. Composition and follow-up drafting still use the bounded history reader; the scanner uses the request accounting pipeline in `requestAnalysis.ts`.

Request records live in each item's `requests` frontmatter, including conversations that currently need no review. Records retain stable origin IDs, exact source quotes, per-request context, open/resolved/uncertain status, explicit archives, reported replies, and the latest reply plan. `requestIds` identifies the asks included in the current review. Bounded notes supply context but never replace these records. Reconciliation pages contain at most four requests and 24,000 serialized request characters; every supplied ID must return with verified citations. Previously resolved asks are reconsidered against later messages so a withdrawal can reopen them. An extraction that reports incomplete coverage or exhausts its output allowance is subdivided, with the split saved for retries. Invalid evidence or missing coverage leaves the scan pending instead of publishing a partial reply.

Validated extraction, reconciliation, attention, planning, brief, and coverage passes are immutable JSON receipts under `analysis/<conversation-hash>/passes/`. Reading inputs include semantic message identities and an ordered prefix fingerprint, excluding the chosen range, scan clock, and whole-capture hashes. Append-only captures reuse their unchanged prefix; edits invalidate the affected portion and everything depending on it. The model settings, owner context, prompts, and interpretation policy participate in invalidation. Attention has its own fingerprint for the current date, declared initiatives, and attention/planning/brief policy; changing these reassesses the review without discarding completed source reads. Attention and reconciliation allow one bounded correction of an invalid model result against the original evidence; a failed correction stays pending and is never cached as valid. A retry reconstructs state from validated receipts, resuming at unfinished work. `completed.json` records a complete reading before drafting, with its source version and prior item revision; it is derived state, while human decisions remain authoritative in the item. Capture and item revision checks still gate publication. Serialized analysis payloads are capped at 120,000 characters, in addition to the fixed instructions and schema. An oversized complete reply fails visibly rather than dropping answers.

The first run of the corrected policy reassesses legacy ignored versions and drops the old-date backlog. It archives untouched, unreviewed conversation items created that day solely from earlier dates; edited, approved, and workstream items retain their normal review lifecycle.

The range policy invalidates earlier cached judgments. A subsequent check can fill an untouched item with a reply even when its saved messages have not changed. Human-directed or edited drafts remain protected. Changing the model or effort reassesses untouched conversations, including previously ignored results. Changing the range reassesses closed conversations too: another request may already exist in the same unchanged capture but fall outside the previous selection.

`responseHistory` preserves the conversation's delivery history. New owner-reported sends also attach the exact wording and evidence to the reviewed request IDs; sending does not automatically resolve all of them. The next check reconciles that wording with each ask, so a partial reply can return the unanswered part to review. Approving a native draft supplies no sending evidence. Archive explicitly dismisses only the reviewed request IDs. Legacy archives and reports are adopted only for origins in their previous source snapshot, preserving human choices without exempting newly discovered asks. A new request reuses the conversation's stable item ID while retaining response history and clearing the old native-draft reference. The new reply requires its own approval.

Short writes use an atomic replacement and a content revision checked under a separate lock. Model work does not hold the writer lock. Capture changes during drafting discard the obsolete proposal; an editor winning a write race keeps their words. An edited or native draft is retained and flagged stale when new messages arrive. A review that already refreshed a source is not invalidated again by a lagging scanner checkpoint.

## Human review and native handoff

`/outbox` lives in Sky's existing shell. Its list separates **Needs review** from **Ready in apps**, with a focused draft editor and source-message rail. Details exposes individual requests, review scope, resolution evidence, and links to their source messages. Explicit approval stores the original/final pair before calling a native draft command. Approval checks the saved source version again and requires acknowledgement of new messages. A provider preflight refuses to overwrite an existing unrelated draft or edits made in the native app.

Item ids come in two shapes. Items created before 2026-09-14 keep their 32-character hash. A new scanner item is named `YYYY-MM-DD_HHMM_Slug` from the notebook-local time and the proposed title, for example `2026-09-12_1705_Approve-the-Atlas-pilot-budget`; a namesake in the same minute gets `-2`. The id is allocated once, when the record is first written, and every later write reuses it. Follow-ups keep deterministic hash ids so a repeated approval finds the child it already queued. Both shapes are valid in routes, the store, the workers, and the writing-draft source `outbox:<id>`; `isOutboxItemId` in `itemId.ts` is the single validator. The scanner finds an existing item by its conversation key.

When several requests in one conversation need the owner's choice, the conversation brief merges them: one question per distinct decision, at most four, with two to four shared reply options. Each request keeps its own questions inside its plan.

The status report carries `done` beside the open `items`: archived, sent, or answered items, newest first, at most one hundred. A conversation the scanner set aside on its own, with nothing drafted and nothing asked, stays out of `done`; it was never the person's to handle. Check results carry a severity. `warning` means a completed check could not check some conversations; the message keeps the counts and the retry sentence. `error` means the check itself failed or nothing could be checked.

Items distinguish **Draft ready** from **Your decision**. Choosing a response option or entering a few words asks Sky to compose the reply locally. Once a draft exists, the shared chat editor supplies **Edit**, **Ask Sky to revise**, **Copy**, **Undo**, and version history, whether or not its record has been saved yet; the first of those actions saves it. Ask Sky opens a discussion focused on the same record. The plain reply box, with **Revise with Sky**, **Shorter**, and **Warmer**, remains for a reply the owner writes from nothing and for a host without the shared draft store. A missing fact remains an explicit question instead of a placeholder or invented answer. Generated text stays in review until the ordinary explicit native-draft approval.

`POST /item/:id/compose` saves the working draft and owner direction under the submitted revision before source checks or model work. `prepareCompose` performs this durable save; a detached worker runs `composePrepared` against its resulting revision. The request returns HTTP 202 after worker registration and releases its short restart hold. Per-item local job state transitions from `running` to `complete` or `failed`; status reads reconnect after a service restart. Job feedback is associated with the saved direction's wording, timestamp, and source version. Terminal feedback also requires the same draft, so a later human edit or a new request in the same conversation does not inherit an old result. Source/workstream freshness is checked before and after writing. A failed model call or freshness check retains the submitted text and direction; a retry uses the saved revision. It never calls provider draft APIs. A newer edit wins a race, new context invalidates an obsolete result, and generated text based on owner direction is retained by subsequent scans. Recent owner directions retain their date and source version, so answering a follow-up does not discard an earlier choice. Browser direction text stays with an unfinished edit, and a late response for an item cannot replace another item's open editor.

Check now returns HTTP 202 after a detached worker is registered in local state. The HTTP request holds automatic service reloads through range saving and worker registration, releasing the hold on both success and failure. The worker owns the manual automation, scan, and completion stamp; the scheduled automation pass also runs outside the service. The browser polls progress, remains usable during the check, and reconnects to the same check after a page reload or service restart. Connection failures retain the last progress and retry automatically. Duplicate clicks and overlapping scheduler runs do not create a second producer. Only the actual worker stopping is reported as interrupted. The reusable [process-job contract](../../jobs/docs/README.md) explains the startup handoff and persisted results; the service never owns a worker cancellation signal. Completion counts remain visible after a reload, with expandable explanations under “What Sky checked.” The same summary is used by the CLI and automation ledger; failed or incomplete work is never described as a complete check. A paused automatic schedule still permits an explicit manual check.

Beeper Desktop captures are saved messages too. `beeper:inbox:sync` writes one file per chat per day with `chat:` and `account:` ids beside the network's name in `medium:`; discovery admits a saved message by those ids whatever its medium, joins a chat's days by the chat id, and names the desktop app as the destination (`target.medium: 'Beeper'`). The card reads WhatsApp or iMessage; Beeper is the app the draft is ready in. See the [Beeper design](../../beeper/docs/README.md).

Outbox’s native placement writes use the existing `slack:draft:reply` / `google:email:draft:reply` and their draft-update commands; a Beeper chat takes the draft through the desktop app's draft endpoint, which fills only an empty composer, and Open in Beeper brings the app forward on the chat. Placement does not send. Request plans distinguish an answer in the source conversation from a promised message elsewhere. Separate messages, and older promises without an established destination, stay local for copying; refreshing the source cannot turn its thread into their destination. Workstream reports can separately use the explicitly authorized [report delivery boundary](../../../lib/workstreams/delivery.ts), which records a provider receipt and then archives the linked review item. A confirmed native reference is required before a row becomes Ready. An interrupted or ambiguous write becomes `placement_unknown` and is never automatically retried; the user checks the app. A process killed during placement is detected on the next status read. Archive removes a row from Outbox without claiming the native draft was sent or deleting it.

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

## Workstream communications

A workstream producer supplies a stable intent ID, an activity reference, and the
draft, up to 40,000 characters so a complete prepared report can be reviewed.
Repeated preparation reuses the existing intent and repairs an interrupted
backlink. A pending reply in the same captured conversation is reused; its edited
text and native draft remain intact. Attaching different context marks the
existing draft for review. Without a verified saved conversation, the draft stays
local with a stated recipient and copy action; an arbitrary address does not
invent a native reply destination.

Each link snapshots the relevant outcome, activity, canonical decisions, and
selected source hashes. The service refreshes changed context while retaining the
draft. Approval rechecks that context and the saved conversation before native
placement. A missing decision or source prevents approval until repaired. Sky's
producer additionally checks the original workstream, permission, and selected
source revisions under the workstream writer lock before queuing its local effect.

`Record that I sent it` records explicit owner evidence and archives the review
item without sending anything. The activity then waits for a result. A separately
recorded response must reference new or changed captured content from the same
conversation, and the owner supplies its meaning and whether it satisfies the
requested result. The original request snapshot is retained even when the scanner
refreshes the current conversation. Native readiness, owner-reported sending,
and assessed responses remain distinct; none closes the whole workstream.

Workstream details and Sky's review derive communication status from the existing
Outbox item. The observation checks its latest saved conversation and includes
bounded recent messages with a stable version, so a captured response can wake a
review without waiting for a new periodic deadline. This read does not mutate the
review item or expose its draft, learning examples, or communication preferences.
It names capture errors and truncation; it cannot observe uncaptured account
activity or infer sending from native draft readiness.

## Verification

The colocated tests cover strict date scope on every run, legacy checkpoint migration, complete checks exceeding five conversations, bounded concurrency, progress and skip explanations, changed history, deduplication, retries, capture/editor races, midnight carryover, explicit review, learning pairs, ambiguous native writes, checkpoint damage, and setup preserving a pause. Drafting tests exercise the real SDK adapter with a mock model, cached summary migration, owner directions, bounded examples, and composition races. HTTP tests exercise origin and payload checks with native writes stubbed. Browser regressions cover HTTP 202, progress, reload recovery, automatic draft creation, response-option composition, shortening unsaved edits, and explicit native handoff with synthetic conversations.

## Notes

- [2026-09-20 — Sky learns from drafts alone](../../writingVoice/docs/2026-09-20-sky-learns-from-drafts-alone.md), in the writing voice docs: Outbox keeps no learning path of its own.
- [2026-09-20 — A draft is saved when it is used](../../writingVoice/docs/2026-09-20-a-draft-is-saved-when-it-is-used.md), in the writing voice docs, which own the shared draft contract.
- [2026-09-16 — Chats from Beeper join the queue](2026-09-16-beeper-conversations.md).
- [2026-09-14 — Readable ids and merged decisions](2026-09-14-readable-ids-and-merged-decisions.md).
- [2026-09-08 — Checks survive service restarts](2026-09-08-checks-survive-restarts.md).
- [2026-09-08 — Fixed search ranges and response memory](2026-09-08-search-ranges-and-responses.md).
- [2026-09-08 — Approval must not wait for follow-up drafting](2026-09-08-approval-before-followup-drafting.md).
- [2026-09-07 — Replies carry their follow-through](2026-09-07-replies-carry-follow-through.md).
- [2026-09-07 — Put the reply back in Outbox](2026-09-07-drafts-and-decisions.md).
- [2026-09-07 — Check now must cover today's conversations](2026-09-07-complete-today-check.md).
- [2026-09-06 — A quiet check still needs a result](2026-09-06-quiet-check-feedback.md).
- [2026-09-06 — Drafts must not outrun review](2026-09-06-drafts-must-not-outrun-review.md).
