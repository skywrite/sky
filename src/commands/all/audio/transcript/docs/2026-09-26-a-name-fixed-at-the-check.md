---
created: 2026-09-26
updated: 2026-09-26
---

# A name fixed at the check

## What was wrong

A voice memo about a one-on-one came through the import. The memo named
a colleague twice — call her Priya, of the profile Priya Raman —
and the transcriber wrote "Pria" once and "Preet" once.

- The names step raised only "Preet" and offered Pria or Prya. The person
  picked Prya, the closer of two wrong spellings. "Pria" was never asked
  about, since the analysis took it for the right one.
- So the corrected transcript said Pria once and Prya once. The write-up
  copied both: "Pria (also transcribed as Prya)", and a Loose End about the
  two spellings.
- At the write-up check the person typed "It's not Pria, it's Priya". The
  fields box showed Priya in rel, under No match. Nothing else changed.
- The meeting filed with Pria in the body, the spelling Loose End, and a
  bare Priya in rel that linked no profile.
- The pick at the names step also became a glossary ruling, "Preet" to
  "Prya". The next memo would have fixed the mishearing to the wrong name.

Why the check did so little: its line went to a fast model that returned
fields and nothing else. The transcript had been corrected before the
write-up existed, and nothing ran back from the check to either. The
hint promised "freeform feedback to improve the summary", and nothing
acted on it.

Why the name was guessed at all: the profile was older than the names
list's twelve months, so the analysis never saw it.

## What changed

- The check's line is read on the reasoning role, like the message door's.
  It returns the fields it changes and the renames it asks for. A rename
  lists every spelling the write-up uses for the name, so "Pria" brings
  "Prya" with it (`lib/parseCorrections.ts`).
- A rename is applied to the transcript by the literal find-and-replace,
  to the people lists, and to the write-up by a model rewrite that carries
  only the rename and drops the notes the old spelling caused
  (`lib/renames.ts`).
- In the lists, a single name that exactly one profile answers to becomes
  that profile's full name. "Priya" became "Priya Raman" and linked.
- When the check ends, the glossary learns each wrong spelling to the
  right one. The names step's "Preet" to "Prya" is re-ruled "Preet" to
  "Priya", from the word the transcriber actually wrote.
- On the page, announcing the write-up step again starts its text over, so
  the rewrite streams in place of the old write-up rather than under it.
- The renames are kept in the run record with the fields, and a rerun
  applies them to the words again. The rewritten write-up is kept too.
- The hint now says what works: a field, or a name spelled wrong.

## Not changed

- A fix to anything but a name or term, "it was 95%, not 90%", still
  changes no text.
- The names list's twelve-month window stays. Widening it was ruled
  against, since the unwindowed list is mostly false phonetic matches.
- A supplied transcript file (`.vtt`, `.srt`, `.txt`) is attached as it
  arrived. Neither the names step nor the check edits the attached file.
