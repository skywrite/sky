---
created: 2026-09-08
updated: 2026-09-13
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
  examples/<id>.md
  drafts/<id>.md
```

The rules body is the editable guide. The first draft or example initializes it
from existing Outbox preferences, or the default guide. Preference seeding and
linked draft checks support the [Outbox storage migration](../../outbox/docs/README.md#files-and-concurrency).
Production Outbox preference reads and writes use this same file. Reads do not cache its contents;
a change applies to the next draft in an existing session.

### Shared drafts in chat and Outbox

Chat and Outbox use the same draft record, mutations, editor, and learning path.
`drafts/` owns the current wording and append-only text history. Outbox items link
to the record through `draftId`; their own files retain source snapshots, review,
dismissal, and native handoff state. Draft acceptance or editing never establishes
that a message was sent. Opening an older inline Outbox draft adopts its known
original, approved pairs, and current text without duplicating past learning.
A new request after dismissal gets a separate draft, preserving the old history.

New drafts and branches use a UTC date/time prefix and a short Haiku-generated
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
response. Ordinary quotations remain read-only. Older recorded `me_voice`
outputs acquire records when the owner first edits or discusses them.

Chat continuation metadata carries draft IDs and the turn where each appeared.
Reply threads share those IDs, so a revision in a draft discussion updates its
parent frame. A separate branch copies the records instead. Each new model turn
receives the current text, including direct edits; model revisions check the
version again after generation, refusing to overwrite intervening edits.
Outbox's Ask Sky action opens a persistent draft discussion referencing this same
record. Saved conversation context is checked before and after an AI
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
a writing preference. Draft history retains the edits and reasons after example
compaction, and draft records survive closing or discarding their conversation.

The browser keeps unsaved editor text independently of polling and restores it
after navigation. A newer saved version requires an explicit choice before that
edit can replace it. Read-only draft text uses `RenderedHtml` to preserve selection.

Each example is one Markdown document with YAML frontmatter holding the source,
medium, recipient, context, owner direction, exact original and revised text,
creation/update times in UTC, one question, exactly two suggested answers, the
owner's actual answer, and a scoped lesson. Its body displays the lesson. Its ID
is a digest of source plus the exact pair, so repeated saves reuse the example.
Names and other source data belong only in the personal notebook; repository
fixtures must stay synthetic.

Chat captures an owner-supplied edit or an explicitly accepted revision. Outbox
captures saved edits and accepted revisions, preserving the owner's direction.
An untouched draft creates no example. Outbox stores the pair before starting
question generation; model work does not hold up native draft placement. Pending
Outbox questions resume after a service restart; failed work waits for Retry.

The question names exact excerpts from the two versions. Its choices are
hypotheses. The user chooses one or writes their own answer; no choice is accepted
by default. The exact answer is saved before extracting a lesson, so a failed
model call can resume without asking again. Drafting uses only answered, learned
examples. Scope and the owner's explanation travel with each lesson; a one-off
content correction cannot silently become a universal writing rule.

Model-facing answer choices use a homogeneous array constrained to exactly two
strings. A tuple emits positional JSON Schema items that Anthropic's structured
output API rejects before generation. Keep the array shape compatible at the
provider boundary and retain the exact count in local validation; saved examples
remain ordinary two-element arrays.

## Compaction and concurrency

After eight confirmed lessons, a background pass considers up to twelve examples.
Settings and the tool also offer explicit compaction. The model merges lessons
from the batch into scoped additions, or cites exact existing rules that already
cover them. Every processed example must be accounted for. Existing rules remain
intact; only supported additions are appended. The owner can edit and consolidate
the full guide in Settings. Unanswered or failed examples remain available.

Rules and example content revisions are checked after model work under a short
writer lock. A concurrent edit refuses the obsolete plan. One atomic rules write
commits both additions and compacted example IDs before deleting any raw examples.
Those small receipts prevent retries from recreating old samples, and let recovery
finish deletion after a crash. They are omitted from drafting context. Compaction
cleans up learning copies; source chats and Outbox approval records retain their
own history. A second process uses the same per-notebook machine-state locks.

Settings → Writing Voice edits rules, exercises the writer, shows examples and
their answers, and offers compaction. Chat and Outbox share the same question
component. Text stays selectable across refreshes, and a question remains separate
from permission to place or send a draft. The ordinary cross-origin and revision
checks apply to these local writes.

The assistant's general cross-session memory continues to own preferences about
how Sky answers the user. Writing in the user's name is owned here, so its rules
are not independently distilled into a second memory store.
