---
created: 2026-08-29
updated: 2026-08-30
---

# Person profiles — what the AI may write, and how it must read

`people/<year>/<xx>/<Name>.md` is the notebook's CRM. Every profile is
hand-authored space. After an `ai:chat` save and after `meeting:new`, a
distiller reads the finished text against the profiles of the people it
discussed and proposes ops. This module applies them. Nothing else writes
to a profile from the AI side.

Pieces:

- `format.ts` — the format law: the knobs and the line mechanics.
- `write.ts` — the ops, the section surgery, the applier, the 👤 outcomes.
- `subjects.ts` — which profiles ride the prompt (name matching, namesakes).
- `lib/notebook/enrich/distillPersonFacts.ts` — the schema and the prompt.
  It asks; it never writes.

## The shape of a profile

Frontmatter, then `# Name`, then `##` sections.

| Part | Owner | What the AI may do |
| --- | --- | --- |
| `## Overview` | AI | Rewrite wholesale. Bullets, 6 lines at most. "Who is this and where do things stand." |
| `## Background` | hand + AI | Append a bullet. Replace one quoted line. |
| `## Family` | hand + AI | Same. |
| `## Info` | hand + AI | Same. |
| Lead prose under `# Name`, `###` sub-sections, dated or one-off sections | hand | Nothing. Passes through verbatim. |
| `location`, `title`, `org` | hand + AI | Fill when empty. Never overwrite. |
| `sites:` | hand + AI | Add a URL, deduped. |
| `name:` list | hand + AI | Move a name to index 0 on explicit "goes by" evidence. Drop nothing. |
| `updated:` | AI | Stamped with today when any op applies. |

## The format law

Why: a profile is read by a human with a short attention span. A 200-word
paragraph is not a profile. Ruled 2026-08-29; the narrative is in
`2026-08-29-profiles-read-as-walls.md`.

The rules. Enforced in `format.ts` and `write.ts`, not only asked for in
the prompt:

- One fact per line, written as a bullet.
- At most `MAX_WORDS_PER_LINE` (15) words per line. Counted on whitespace.
- `## Overview` holds at most `MAX_OVERVIEW_LINES` (6) lines.
- Model text is normalized before the cap check (`toFactLines`). Heading
  lines drop. A line that is only a section name drops (a heading echo).
  List markers strip. Each line splits on `; ` and on sentence ends.
  Abbreviations do not split: `Dr.`, `St.`, `Jan.`, `U.S.`, `e.g.`, single
  initials. Splitting never rewords, with one exception: a cut piece that
  starts with two lowercase letters gets a capital (`iPhone` stays).
- A line over the cap is refused, never trimmed. For an Overview the whole
  op is refused and the current Overview stays. For a note or a replace,
  that op is refused.
- Every refusal is visible. The 👤 line says `skipped: over 15 words: "…"`
  or `skipped: 7 lines, cap 6`.

To tweak:

- A cap: change the constant in `format.ts`. The schema descriptions, the
  prompt, and the applier all read it.
- What counts as a sentence end or an abbreviation: `SENTENCE_END` and
  `ABBREVIATIONS` in `format.ts`.
- The prompt's wording: `personFactsPrompt` in the distiller.

Asked for in the prompt but not enforced: no em-dash chains (splitting on
dashes would mangle names and asides), tense, plain words.

## Dedupe and replace

Line key: list marker off, trailing period or bang off, lowercased,
trimmed. Two lines with the same key are the same line.

- `note`: each resulting line dedupes against every line in the section,
  sub-sections included. All duplicates → `skipped: already noted`.
- `replace`: `old` must key-match one whole existing line in the named
  section. No match → `skipped: old line not found`. A heading →
  `skipped: old line is a heading`. Same text → `skipped: unchanged`. The
  new line lands as a bullet where the old one stood.

## Where new lines go

- `overview`: replaces the section body. Created as the first section when
  missing.
- `note`: inside the section's own body, above the first `###` sub-heading.
  Consecutive bullets stay one list. After prose, a blank line separates.
- A section that does not exist yet is created at the end.

## Cleanups on touch

Value-preserving, and only when at least one op applied. A save where
every op skips writes nothing.

- Heading canonicalization: `Family / Relationships` → `Family`, `Contact`
  or `Links` → `Info`, `About` → `Background`. Same-named sections merge,
  later content appended to earlier.
- Heading echo: a section whose first line is just its own heading name
  loses that line.
- Frontmatter re-serialized in the standard field order. `who:` → `name:`.
  Tags normalized to the `;` string.
- Blank-line spacing between sections normalized. Line content passes
  through verbatim.

## Guarantees and their limits

- Nothing is deleted unquoted. The only lines that ever disappear are one
  the distiller quoted verbatim in a `replace`, and a heading echo.
- The Overview rewrite is asked to carry every still-true fact. That is a
  prompt promise, not a code check. The cap keeps it finite: the Overview
  is the current picture, not an archive. Durable facts belong in the
  append sections.
- Hand content is never reformatted. Old paragraph lines stay paragraphs.
  New lines are bullets. A section can hold both.

## Caps and conflicts

- 8 people per save, 10 ops per person, 6 unlisted lines (the excess folds
  into one line). Past a cap, ops skip visibly. The per-person cap sits
  above a rich conversation's honest count: overview, three field fills,
  two replaces, a note, a rename is eight.
- Writes go through the service (`DocumentIO`), version-checked. A conflict
  re-applies once against the fresh content, then yields.

## Who rides the prompt

`subjects.ts` decides which profiles the model sees. Two modes.

Chat (`ai:chat`). The user is the speaker.

- A full name in the text pins its profile.
- A bare first name resolves by interaction score. The leader rides alone
  when it scores `SCORE_DOMINANCE` (3×) the runner-up. Below that the top
  `PER_HANDLE_LIMIT` (2) ride and the model judges.
- A 0-score namesake never rides beside a scored one. A new profile does
  not change a bare name's resolution until it earns a score.
- A handle counts only capitalized, and not when the text also uses it in
  lowercase.

Meeting (`meeting:new`). The transcript pipeline already matched names
against the contacts list, and the user confirmed the who/rel lists at the
corrections prompt. Those lists are the anchors.

- A full name in who/rel pins its profile, whether or not the summary
  repeats it. `profilesPinnedBy` is the rule: two or more words, every
  word in the alias.
- A bare name in who/rel pins nothing. Not by score. Not as the only
  namesake. Not as an explicit alias.
- A full name in the summary text still rides.
- The pipeline's metadata box prints `Profiles:` (what will be written to)
  and `No match:` (bare or unknown names) before the corrections prompt.
  Retyping the list with a full name pins: `rel: Sam Rivera, Jordan`.

Why the split: the score is a prior on the user's own bare names. In a
meeting a bare name usually lives in the attendee's world. Ruled
2026-08-30; the narrative is `2026-08-30-namesake-from-the-other-side.md`.

To tweak: `SCORE_DOMINANCE`, `PER_HANDLE_LIMIT`, `DEFAULT_LIMIT`,
`MIN_NAME_CHARS` in `subjects.ts`. The pin rule is `profilesPinnedBy`; the
pipeline's box reads it too, so the two never disagree.

## Hosts

`ai:chat` (`Chat/ChatStore/save.ts`) and `meeting:new`. Both print the 👤
lines through `formatPersonOpLine`. The chat's context log records the
outcomes. `meeting:new` passes the confirmed who/rel as anchors; the chat
passes none.

## Open

- Pruning and corpus-wide normalize: deferred by ruling. Organize-on-touch
  only.
- AI-written paragraphs from before 2026-08-29 (walls, heading echoes)
  self-heal on the next applied op to that file. A one-off pass over the
  rest is a separate command with its own go.
- `replace` cannot target the lead prose under `# Name` or a dated section.
- Chat discovery keeps the score prior. A bare name the user types about
  someone else's world ("her fiancé Sam") still resolves to the user's
  top-scored Sam.
- `who:`/`rel:` corrections parse through the fast model, and a typed line
  replaces the list. A deterministic lift, as `time:` has, is the next rung.
- The unlisted lane screens a bare name against every namesake, so a
  fiancée named Sam reports `profile exists: Sam Rivera` — a dim hint, no
  write.
