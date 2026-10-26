---
created: 2026-08-29
updated: 2026-10-25
---

# The memory store — what the assistant carries between chats

`ai/memory/` in the notebook is the assistant's own cross-session memory:
one markdown file per fact, written and pruned by the assistant under a
standing license, read by every chat. It sits between two other records
and must duplicate neither:

- the **notebook** (long-term, human-curated) — always wins on conflict;
- the saved **chats** (episodic) — already hold every answer given.

Writing in the owner's name has its own [writing voice](../../../../lib/writingVoice/docs/README.md)
rules and revision examples. Memory retains preferences about how the assistant
answers the user; it does not duplicate the writing agent's lessons.

Memory is the residue: what no capture flow would take and no chat would
be re-read for. The law that keeps it small:

> Memory holds what the **user** taught, corrected, asked to remember, or
> relied on. Never what the assistant concluded — that is saved with the
> chat.

## Kinds — one meaning each

| kind        | holds                                                          | half-life                                   |
| ----------- | -------------------------------------------------------------- | ------------------------------------------- |
| preference  | how the user wants answers or behavior                         | until contradicted                          |
| glossary    | what shorthand, an abbreviation, or a nickname means           | until contradicted                          |
| thread      | an informal open loop no task or document tracks               | 14 days                                     |
| observation | a stable fact about the user's own setup no document records   | 45 days; confirmed 3× → proposed for capture |
| lesson      | what answering/retrieval strategy works or fails for this user | until contradicted                          |

"Lesson" is about *serving this user*, not domain insight. "Observation"
is about the user's own life and setup, not a fact learned from a
document. The first live week misread both — see the
[2026-08-29 narrative](2026-08-29-distiller-harvested-its-own-answers.md).

## Exclusions from automatic capture

- Figures from a document under discussion — the document holds them and
  a copy goes stale first.
- The conversation's own analysis or takeaways — that is the answer, and
  the saved chat keeps it.
- Assessments of other people — the person distiller owns those.
- Designs, plans, decisions, ideas worked out in one chat — capture flows
  own those.
- Events, meetings, tasks, anything else the notebook records.

An explicit request to remember a commitment or time-bound fact can save it as a thread, with its concrete date and context.
That request does not authorize invented details or changes to the authoritative notebook record.

## File shape

```markdown
---
created: 2026-03-10
updated: 2026-03-10
kind: glossary
summary: The big deck means the Atlas overview deck
source: time/2026/W11/03-10/actions/ai-chats/09-30_Atlas-Launch-Planning.md
lastConfirmed: 2026-03-12
uses: 2
locked: true
---

When Jane says "the big deck" she means the Atlas overview deck.
```

- `source` identifies the teaching chat: its notebook path after save-time capture,
  `/chat/source/<id>` for a live web chat, or `chat:terminal:<start-time>` for terminal chat.
  A confirm keeps it; an update moves it to the correcting chat.
- `uses` counts distinct sessions that confirmed the memory.
- `locked: true` is hand-set: no writer rewrites, deletes, or
  confirms the file, and budget eviction skips it — so a locked memory
  never accumulates `uses`. Hand-written seeds are locked; a seed that
  should keep earning confirms stays unlocked.
- Hand edits always win; the dir is plain markdown.
- Bodies are 1–3 sentences in the third person that still read months
  later — no "tonight", no "the report above".

## Read side (`mod.ts`)

- `loadMemories` reads the dir straight from disk, freshest first — the
  prompt must assemble with the service down.
- Preferences render into the **Standing Memory** block of the chat
  system prompt (`renderPreferenceBlock`, 2k-token cap, frozen at session
  start for prompt-cache stability). Every preference is therefore a
  standing instruction in every chat; the kind has to be earned.
- Glossary + lesson render into the query producers
  (`renderVocabularyBlock` → `ai:context:sel` / `ai:context:evolve`), so
  first-turn retrieval already searches canonical terms.
- Every memory also rides the chat context universe as a scored document
  (entity type `memory`); the scorer ships on-topic ones and floors the
  rest — in practice ~35 of 40 per turn.

## Write side

- `commands/lib/chat/memoryTools.ts` exposes `search_memories` and `remember` in both full chat hosts.
  An explicit instruction to remember is saved in the current turn, without another confirmation or waiting for chat close.
  The host supplies the memory directory, conversation source, and current message date; the model supplies only the fact.
  The result reads the saved file back and returns its text and explorer link before the assistant confirms success.
  It persists even if the conversation is later discarded.
  The standing prompt stays frozen in the current session; the tool result carries the new fact until future chats load it.
- Search returns exact contents and a revision for corrections.
  Semantic IDs preserve the existing store's deduplication and correction identity across retries.
  A new request cannot overwrite an existing ID; a correction must match the revision it read.
  Identical kind and body return the existing memory without another write.
- `lib/notebook/enrich/distillMemories.ts` runs at chat save
  (`Chat/ChatStore/save.ts`) on the `balanced` role: the packed transcript
  against the store's index → ops `create` / `confirm` / `update` /
  `delete`. No `propose` from the distiller — a proposal printed at chat
  exit had no consumer.
- `write.ts` applies them. `MAX_OPS_PER_SAVE` (8) bounds runaway output;
  `MAX_CREATES_PER_SAVE` (3) bounds growth and counts only new files — a
  create on an existing slug is an update. Locked and missing targets skip
  with a reason. Save-time outcomes render as a 🧠 line at chat exit and land
  in the chat's CONTEXT-LOG `memory` field.
- Every writer shares a machine-local lock outside the synced notebook.
  Writes publish complete files atomically, new files reserve their names exclusively, and linked targets are rejected.
  Direct corrections check revisions under that lock so another Sky writer cannot overwrite an intervening change.
- The chat system prompt tells the model memories are notes, not the
  record.

## Consolidation (`consolidate.ts` → `sky ai:memory:consolidate`)

Weekly, hand-run until automations land (`--dry-run` prints the plan and
touches nothing). Deterministic policy over frontmatter: thread and
observation expiry; observation promotion at `uses ≥ 3` (a `propose` op,
printed, never auto-captured); durable kinds expire only when 180 days
stale *and* never shipped — ship telemetry comes from `usage.ts`, mined
from CONTEXT-LOGs, and `chatsScanned = 0` means unknown, not zero; then a
15k-token store cap evicting weakest-first (ships → uses → freshness →
slug). The one AI step merges near-duplicates (`dedupeMemories.ts`).

## Narratives

- [2026-08-29 — the distiller harvested its own answers](2026-08-29-distiller-harvested-its-own-answers.md)
