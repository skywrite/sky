---
status: shipped
created: 2026-08-29
updated: 2026-08-29
---

# The distiller harvested its own answers

Figures are from the write side's first live week (2026-08-24 → 08-28,
21 chats through the distiller); examples are synthetic.

## Symptom

Five hand-written seeds became 49 files in five days — 36 of them on one
day. Reading them:

- 76% of chats wrote memories; the prompt said most conversations teach
  nothing. Ledger: 41 creates, 16 confirms, 2 updates, 0 deletes.
- Bodies were the assistant's own closing sentences, verbatim. Traced back
  to **AI** turns in the source chats, not user turns.
- 25 "observations" and 16 "lessons" against 2 preferences and 2 glossary
  entries. "Lesson" had been read as *insight*, "observation" as *fact
  from the conversation*. Three lessons were about serving the user.
- Report metrics, deal math, treasury positions, a compensation figure —
  all copied out of documents the notebook already held. One memory
  snapshotted a position right next to a lesson saying never to trust
  exactly that kind of snapshot.
- Seven assessments of named people ("strongest operator", "failure mode
  is…"). The prompt said never; the person distiller owns those.
- Eight files from one design conversation: a spec cut into memory cards.
- One late-night philosophical chat wrote a `preference`, which rides the
  Standing Memory block of **every** later chat. Its body said "tonight".
- The seed announcing "nothing writes memories yet" was the single
  most-shipped memory (19 ships), telling every chat something false.
- `confirm` overwrote `source:`, so provenance moved to whichever chat
  last relied on the memory.

The read side held: the scorer floored ~35 of 40 memories per turn and 20
of 49 never reached a prompt. The damage was store quality and the
standing block, not context flooding.

## Root cause

Three things compounded:

1. **The transcript includes the assistant's turns, and the bar never said
   whose words count.** A finished chat is mostly assistant prose, crisp
   and quotable. Asked "what should the store learn", the model summarized
   its own answer.
2. **The fast model ran the judgment call.** Telling "the user taught
   this" from "I concluded this" is exactly the discrimination a small
   model drops under a one-line instruction.
3. **The op cap bounded output, not growth.** `MAX_OPS_PER_SAVE = 8` bound
   once all week. Eight creates from one chat were inside policy.

Two smaller ones: the kind definitions were one clause each, so "lesson"
drifted to its everyday meaning; and `propose` — the outlet for decisions
and ideas — printed one line at chat exit and was gone. Five good
proposals fired; none was captured.

## Rejected

- **Only raise the bar in prose.** The old prompt already said "most
  conversations teach nothing" and "never store what the notebook
  records". Prose without whose-words-count and without negative examples
  did not hold.
- **Lower the op cap.** The cap bound once; growth needed its own cap, and
  confirms must stay free or the store never learns what it relies on.
- **Give `propose` a landing spot** — a proposals file, a day-file line, a
  chat frontmatter field. Each is a new surface with no consumer today.
  Decisions and ideas made in chat are captured in the chat by the
  creation tools; the save-time backstop is dropped until something reads
  it.
- **Strip assistant turns from the distiller transcript.** A correction
  ("no — X means Y") only makes sense against what was said. The turns stay
  as context; the prompt now says they are never a source.

## What shipped

- Distiller prompt rewritten: a whose-words-count section, the
  never-memory list, one-meaning kind definitions, third-person and
  no-relative-time rules, seven synthetic calibration examples. `propose`
  removed from the distiller's schema (the consolidator still emits it).
- Distiller role `fast` → `balanced`.
- `MAX_CREATES_PER_SAVE = 3` in `write.ts`, counting only new files;
  `maxCreates` override for hosts that need more. Skip reason:
  `per-save create cap`.
- `confirm` keeps `source:`; only `update` moves it.
- Hand pass on the live store: 49 → 9 — the three confirmed memories, the
  seeds minus the rollout note, the one retrieval lesson, the open
  threads. Seeds locked; provenance restored on the two re-sourced files.

## Watch for

- Growth per chat should sit near zero, with confirms outnumbering creates
  within a week or two. If that ratio reverses, the bar slipped again.
- Every new `preference` deserves a look — it is a standing instruction in
  every chat.
- The consolidator's dedupe caught 3 of ~7 near-duplicate pairs. The
  tighter bar shrinks its input; the dedupe prompt was left alone.
