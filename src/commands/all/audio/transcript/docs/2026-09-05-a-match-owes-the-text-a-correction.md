---
created: 2026-09-05
updated: 2026-09-05
---

# A match owes the text a correction

## What was wrong

A voice memo about a call came through the import. The transcriber heard a
colleague's first name as a similar-sounding name — call it "Tanesha" for
Tanisha Patel — most of the times it was said, and right once or twice. The
analysis step matched her to her contact for the rel list, so the filed
meeting's `rel:` carried "Tanisha Patel". The write-up said "Tanesha"
throughout, and noted under Loose Ends that the transcript used two
spellings for the same person.

Three things lined up to produce that:

- The analysis returns the people and the issues as separate outputs.
  Matching a name for the list did not oblige the model to raise the
  spelling as an issue, and this time it did not. The only path from the
  match to the text was the model remembering to.
- The write-up prompt says the transcript "contains no spelling errors or
  name errors" and to preserve names exactly as stated. It did, and put the
  discrepancy in Loose Ends rather than resolving it — as asked.
- The same pair had been fixed on an earlier memo, at high confidence, and
  nothing kept it: only reviewed medium- and low-confidence items became
  glossary rulings. The fix had to be found again from scratch, and was not.

The CLI would have filed the same document. Both surfaces run the same
chain, the same review form (accept, custom, or skip, over the issues the
model raised), and the same corrections line, which rewrites fields, not
the write-up.

## What changed

- The analysis prompt's People Extraction returns each person as a name plus
  `misheard`: the transcript's spellings that are mishearings of that name.
  Matching a person under a different spelling now fills a field beside the
  match, instead of relying on a separate list being remembered.
- `lib/misheardNames.ts` turns those into high-confidence name corrections
  before the replacer runs. A one-word mishearing becomes the one token of
  the contact's name it stands for (by string similarity, first token on a
  tie); a longer one becomes the full name. A spelling the model already
  raised as an issue is left to that issue. Both people shapes parse, so a
  run record kept before the change still restores.
- `lib/contactNames.ts` decides which high-confidence name fixes the glossary
  learns: those whose target is a contact's full name or one token of it.
  They enter as confirmed corrections and reach the transcriber's vocabulary
  through the existing keywords path. Other auto-fixes stay unrecorded.

## What it does not do

- A person matched for who/rel whose name appears in the transcript under no
  spelling the model listed is not caught. That needs a review item of a
  different shape — "which word is this person?" — on both surfaces.
- Organizations and projects are matched for correction the same way people
  are, but only people have a list to hang misheard spellings on. A
  high-confidence org fix is still applied once and forgotten.

## Verified

- Unit tests: the corrections a match produces, what is skipped, which fixes
  land on a contact, and the occurrence count the replacer will report.
- The recording that prompted this, through `audio:transcript:clean
  --from-audio` on the landed code, non-interactive: the cleaned transcript
  carries the contact's spelling only — the mishearing appears zero times —
  the rel list names the contact, and the glossary gained the pair as a
  confirmed correction (one new ruling). In that run the model raised the
  spelling as an issue itself, so the synthesized correction was not
  needed; that path is covered by the unit tests, not by this run.
- `bun run dev:check` green; the transcript group's tests pass.
