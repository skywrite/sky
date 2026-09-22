---
created: 2026-09-08
updated: 2026-09-20
---

# Writing voice

`WritingVoice` is the shared writer for prose in the notebook owner's name.
The caller supplies grounded meaning, recipient, medium, context, and direction.
The writer owns expression and preserves facts, uncertainty, links, and intended
commitments. Its model has no tools or delivery authority. Chat exposes it as
`me_voice`; Outbox triage, composition, follow-ups, and Sky-authored workstream
communications call the same writer. Chat's shared system prompt routes drafting
and accepted revisions to this tool, including when a built-in prompt is customized.

Settings > Writing Voice selects `ai.writingVoiceProfile` in the app configuration.
It defaults to `default-fable-5.1-high` and applies to drafting, question generation,
lesson extraction, and compaction. `model.ts` reads the selection and custom profile
definition on every call, then uses the shared registry's `resolveProfile`.
Do not replace that read with the registry's cached `getProfile`: configurations
created or edited during a running chat must take effect on its next voice call.
An unavailable selection reports the setting to repair. Settings prevents deleting
a selected custom configuration without choosing another one first.

## Notebook records

```
me/voice/
  rules.md
  drafts/<id>.md
```

Drafts are the only thing Sky learns from. A draft holds the owner's words, every
version, and what Sky learned from each change. The rules receive those lessons
when they are folded in. See
[Sky learns from drafts alone](2026-09-20-sky-learns-from-drafts-alone.md).

The rules body is the editable guide. The first draft initializes it
from existing Outbox preferences, or the default guide. Preference seeding and
linked draft checks support the [Outbox storage migration](../../outbox/docs/README.md#files-and-concurrency).
Production Outbox preference reads and writes use this same file. Reads do not cache its contents;
a change applies to the next draft in an existing session.

### Shared drafts in chat and Outbox

Chat and Outbox use the same draft record, mutations, editor, and learning path.
`drafts/` owns the current wording and append-only text history. Outbox items link
to the record through `draftId`; their own files retain source snapshots, review,
dismissal, and native handoff state. Draft acceptance or editing never establishes
that a message was sent. A new request after dismissal gets a separate draft,
preserving the old history.

A record exists only for a draft the owner has used: edited, asked Sky to revise,
accepted or restored a version of, approved into its app, or recorded as sent.
Until then the words stay where Sky wrote them, a chat turn's recorded `me_voice`
result or the Outbox item's own state file, and both surfaces show them in the
shared editor as an unsaved draft under a provisional id. The first use saves the
record with the history shown, including an older item's original, approved pairs,
and current text, without duplicating past learning. A deleted draft file never
breaks its item or chat; they fall back to the words they hold. See
[A draft is saved when it is used](2026-09-20-a-draft-is-saved-when-it-is-used.md).

Saved drafts and branches use a UTC date/time prefix and a short Haiku-generated
summary, slugified without changing capitalization, for example
`2025-03-15_12-34-56Z_Atlas-API-Update.md`. Allocation checks filenames under a
shared lock, including case-insensitive collisions, adding a numeric suffix only
when necessary. Naming failure falls back to words from the completed draft;
it cannot discard successful writing. Existing IDs remain valid in records and
saved chat links.

The shared `WritingDraftEditor` supplies editing, revision discussions, copying,
version comparisons, restoration, and learning questions in both surfaces. The
transcript retains the wording originally shown. Each main-chat response that
quotes a writer-owned draft displays it in full: earlier appearances show their
original wording with Copy, and the latest appearance owns the current editor.
Reply-thread revisions update that current frame in place without adding a main
response. Ordinary quotations remain read-only. A recorded `me_voice` output
acquires its record when the owner first edits or discusses it, or asks for a
revision of it.

Chat continuation metadata carries draft IDs and the turn where each appeared.
Reply threads share those IDs, so a revision in a draft discussion updates its
parent frame. A separate branch copies the records instead. Each new model turn
receives the current text, including direct edits; model revisions check the
version again after generation, refusing to overwrite intervening edits.
Outbox's Ask Sky action opens a persistent draft discussion referencing this same
record. Linked source and workstream context is checked before and after an AI
revision, using the same follow directories as Outbox. A context-only update also
invalidates an in-flight proposal, even when its text revision has not changed.

Outbox's content revision includes the shared draft's text revision, so a chat
edit invalidates obsolete approval and save requests. Outbox writes acquire its
metadata lock before the draft lock and hold the draft lock through metadata
replacement. Direct draft mutations inspect linked Outbox state while holding
the draft lock; an in-progress or unconfirmed native handoff freezes its wording.
Later edits preserve the approved snapshot and require review before updating the
native draft. Learning metadata does not create spurious text conflicts.

Saving an owner edit captures its original, revised text and optional explanation.
An explicit explanation goes straight to learning without generating a redundant
question. Otherwise the existing optional learning question applies. AI revisions
remain proposals until the owner accepts them, using the actual conversation
direction as evidence. Restoring a version appends a new version without creating
a writing preference. Draft history retains the edits, reasons and lessons after
they are folded into the rules, and draft records survive closing or discarding
their conversation.

The browser keeps unsaved editor text independently of polling and restores it
after navigation. A newer saved version requires an explicit choice before that
edit can replace it. Read-only draft text uses `RenderedHtml` to preserve selection.

An edit is one version the owner wrote or accepted, read with the version it
replaced (`learnFrom`). That version keeps the whole learning conversation: one
question, exactly two suggested answers, the owner's actual answer, and a scoped
lesson. The draft's readable history shows the reason and the lesson under their
version. `draftEdits.ts` reads an edit from a draft; nothing stores one separately.
Its ID is `<draft id>:<version>`. Names and other source data belong only in the
personal notebook; repository fixtures must stay synthetic.

Chat learns from an owner-supplied edit or an explicitly accepted revision. Outbox
learns from saved edits and accepted revisions, preserving the owner's direction.
Sky's own wording is never evidence: a version only Sky wrote teaches nothing, and
an untouched draft has no record at all. An edit from a place that kept no draft,
the Settings page or a terminal chat, becomes a draft at that moment; saving the
same change from the same place again returns that draft. The words are saved
before any question is generated; model work does not hold up native draft
placement. Pending questions resume the next time the draft is read; failed work
waits for Retry.

The question names exact excerpts from the two versions. Its choices are
hypotheses. The user chooses one or writes their own answer; no choice is accepted
by default. The exact answer is saved before extracting a lesson, so a failed
model call can resume without asking again. Drafting uses only answered, learned
edits whose lessons the rules do not hold yet. Scope and the owner's explanation travel with each lesson; a one-off
content correction cannot silently become a universal writing rule.

Model-facing answer choices use a homogeneous array constrained to exactly two
strings. A tuple emits positional JSON Schema items that Anthropic's structured
output API rejects before generation. Keep the array shape compatible at the
provider boundary and retain the exact count in local validation; saved questions
remain ordinary two-element arrays.

## Compaction and concurrency

After eight confirmed lessons, a background pass considers up to twelve edits.
Settings and the tool also offer it explicitly. The model merges lessons
from the batch into scoped additions, or cites exact existing rules that already
cover them. Every processed edit must be accounted for. Existing rules remain
intact; only supported additions are appended. The owner can edit and consolidate
the full guide in Settings. Unanswered or failed edits remain open.

The writer must not open every draft the owner has kept. One empty file per draft
under the machine state's `drafts/learning/` marks the drafts that still hold an
open edit; every draft write keeps its own mark current, and a missing folder is
rebuilt from the drafts. A mark whose draft the owner deleted is dropped when read.

The rules revision and each edit's learning state are checked after model work. A
concurrent edit refuses the obsolete plan. One atomic rules write commits both the
additions and a `folding` receipt naming the edits it took. Their versions are then
marked `folded`, and the receipt is dropped. A crash in between leaves the receipt:
the writer skips those lessons, and the next pass finishes marking. Learning state
is saved under the rules lock first, then the draft's lock, so a fold-in never
meets a half-saved answer. Nothing is deleted; the draft keeps the lesson as
history. A second process uses the same per-notebook machine-state locks.

Settings → Writing Voice edits rules, exercises the writer, shows open edits and
their answers, and offers the fold-in. Chat and Outbox share the same question
component. Text stays selectable across refreshes, and a question remains separate
from permission to place or send a draft. The ordinary cross-origin and revision
checks apply to these local writes.

The assistant's general cross-session memory continues to own preferences about
how Sky answers the user. Writing in the user's name is owned here, so its rules
are not independently distilled into a second memory store.

## Notes

- [2026-09-20 — Sky learns from drafts alone](2026-09-20-sky-learns-from-drafts-alone.md).
- [2026-09-20 — A draft is saved when it is used](2026-09-20-a-draft-is-saved-when-it-is-used.md).
