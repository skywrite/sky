---
created: 2026-09-06
updated: 2026-09-06
---

# Outbox — decisions prepared from saved conversations

Outbox is the first **system automation**. `sky outbox:setup` installs an ordinary charter in `automations/outbox.md`: `kind: system`, `run: outbox:scan`, `every: 5m`. The existing automation scheduler supplies cadence, quiet hours, pausing, and run history. Setup is idempotent and preserves an existing charter's status and schedule. Slack follow checks and Gmail follow sync remain in the service heartbeat; they are not migrated by this feature. `kind` is a designation, not a second scheduler or a new privilege.

The worker reads already saved Slack and email messages under `time/…/actions/messages`. Coverage is the coverage of the existing captures, not every message in the connected accounts. The first pass baselines older files by filesystem metadata and queues today's files. Later passes queue new or changed captures, including captures filed under older dates. Stable time references survive notebook layout changes. Follow records and `previous:` links supply older conversation context. Merged follows have no automatic native destination. Missing or excessive context is surfaced in the decision.

## Judgment and voice

The judgment pass identifies messages that need no response, grounded replies, and decisions requiring the owner. It receives the saved conversation, bounded owner context from `journal/about-me.md`, explicit preferences, and recent approved edit pairs. The separate voice pass shapes the intended meaning and learns style from original/approved pairs. Neither pass has tools. Both prompts treat source messages as untrusted evidence. Prompts use the shared prompt library, so their notebook overrides take effect on the next run.

Default preferences emphasize direct, brief, empathetic, humble communication, factual uncertainty, and no unsolicited meeting proposals. Your voice edits `outbox/preferences.md`. Examples teach preferences and style, not transferable facts or standing permission for commitments. Learning here means retrieving approved examples for subsequent drafts, not model training.

## Files and concurrency

Decisions live in `outbox/items/<conversation-hash>.md`. The body is the current draft; frontmatter retains the situation, reasoning, questions, source snapshots, original draft, approved pairs, and native draft reference. Ordinary reads survive service restarts. Scanner metadata and locks live under the user-data state directory, scoped by notebook root. A damaged checkpoint is an error, not permission to reset the baseline and replay work.

One process owns a scan at a time, including a manually invoked scan. Each pass handles at most five changed conversations; model calls have 45-second deadlines. Successfully examined versions are deduplicated, failed work stays queued, and metadata-only message edits do not redraft. Pending decisions carry across days.

Short writes use an atomic replacement and a content revision checked under a separate lock. Model work does not hold the writer lock. Capture changes during drafting discard the obsolete proposal; an editor winning a write race keeps their words. An edited or native draft is retained and flagged stale when new messages arrive. A review that already refreshed a source is not invalidated again by a lagging scanner checkpoint.

## Human review and native handoff

`/outbox` lives in Sky's existing shell. Its list separates **Needs review** from **Ready in apps**, with a focused draft editor and source-message rail. Explicit approval stores the original/final pair before calling a native draft command. Approval checks the saved source version again and requires acknowledgement of new messages. A provider preflight refuses to overwrite an existing unrelated draft or edits made in the native app.

Check now shows an immediate checking state and the command's completion result beside the button, including when no draft is produced. The last saved scan's counts remain visible after a reload. The same summary is used by the CLI and automation ledger; it distinguishes conversations needing no reply, new review items, stale drafts, failures, and work still waiting. Request failures appear at the control that initiated the check.

The only native writes are existing `slack:draft:reply` / `google:email:draft:reply` and their draft-update commands. There is no send path. A confirmed native reference is required before a row becomes Ready. An interrupted or ambiguous write becomes `placement_unknown` and is never automatically retried; the user checks the app. A process killed during placement is detected on the next status read. Archive removes a row from Outbox without claiming the native draft was sent or deleting it.

This first producer consumes saved Slack/email conversations. Chat/voice capture into the same queue and observation of actual sent messages are subsequent producers/reconciliation work, not simulated by this implementation. Freshness is checked against saved captures; changes not yet captured by follow sync are outside that guarantee.

## Verification

The colocated tests cover initial scope, old-dated new captures, full saved thread context, deduplication, quiet passes, model retry, capture/editor races, midnight carryover, explicit review, learning pairs, ambiguous native writes, checkpoint damage, and setup preserving a pause. The HTTP tests exercise origin and payload checks with native writes stubbed.

## Notes

- [2026-09-06 — A quiet check still needs a result](2026-09-06-quiet-check-feedback.md).
- [2026-09-06 — Drafts must not outrun review](2026-09-06-drafts-must-not-outrun-review.md).
