---
created: 2026-11-26
updated: 2026-11-26
---

# Names in live dictation

## What was wrong

Live dictation spelled the notebook's names by sound.
A dictated "Review Jane Doe's roadmap" came back as "Review Jaindoze roadmap".
A product called "Atlas Console" came back as "Atlus consul".
The live transcriber had never been told a single name the notebook knows.

Transcript imports already check names: the analysis step of `audio:transcript:clean`.
The first question was whether that check could run on a short dictated note in a second or two.

## What was measured

All timings are from 2026-11-26.
The spoken tests used text-to-speech recordings in four voices, the same audio for every comparison.

- **The transcript check, unchanged, on a three-word note took 33 seconds.**
  The answer was right.
  The cost does not come from the note: the prompt carries the name lists and the saved corrections whatever
  the note's length, and the reasoning role thinks at its highest effort.
- **The same prompt at low effort took about 6 seconds.** Still right, still too slow.
- **The fast role answered in about a second and left the name wrong.**
  It flagged the word and proposed no replacement.
- **`gpt-live-transcribe` accepts `keywords` in its session.**
  Without keywords every recording came back as a sound spelling.
  With the notebook's names as keywords, the name came back, usually spelled as listed and sometimes in its
  more common spelling ("Jayne Doe" for "Jane Doe").
  The final text arrived no later than before.
  The credential endpoint accepted 16,000 made-up keywords, far more than a notebook holds.
- **A names-only prompt on `default-gpt-6.1-sol-ultrafast` at low effort was right on every test note.**
  It took one to two seconds.
  It also left alone ordinary sentences that collide with a saved correction.

## What was considered

- **Run the transcript check as it is.** Rejected: half a minute for three words.
- **Keywords alone.** Not enough: the common spelling of a name still slips through.
- **The check alone.** It works, but the words stream wrong while the person speaks,
  and the model then has to recover a name from a sound spelling. Keywords cost nothing and remove most of that.
- **Replay the saved corrections as find-and-replace.** Rejected after testing it on ordinary sentences.
  A correction ruled once inside one transcript, such as "Open Notes" to "Open Atlas",
  rewrote a note that really said "Open Notes".
  Limiting the replay to name-shaped, multi-word corrections still rewrote ordinary sentences,
  and it skipped real fixes whose misheard side is ordinary lowercase words.
  The saved corrections are written for a model that reads the sentence. They are context, never a script.

## What was built

1. **Keywords before the person speaks.**
   The credential route asks for the notebook's names and puts them in the session as `keywords`:
   people heard from within a year, strongest first, then scored companies, projects with their hyphens
   as spaces, and the names in the saved transcript corrections.
   A list that cannot be read is reported to the AI error log and dictation starts without it.
2. **One check after Stop.**
   The page sends the final transcript to `/:ymd/item/dictation/names`.
   `lib/dictation/names.ts` renders the name lists and the saved corrections into
   `prompts/names.prompt.md` and asks the model for `{from, to}` replacements.
   A replacement is applied only when its `to` spells a listed name; anything else the model returns is dropped.
   The surviving pairs go through `applyCorrections`, the same replacer the transcript check uses.
   A notebook with no names skips the model call.
3. **The draft waits for the check.**
   The words stay read-only under "Checking names…" until the check answers, so nothing unchecked is saved by a
   fast tap.
   The model call times out after 5 seconds and the page gives up after 7.
   A failed check keeps every word, says the names went unchecked, and leaves the draft editable.

## What this costs

The names leave the machine: as keywords with every dictation session, and as lists with every check.
Each dictation makes one model call whose prompt is almost entirely those lists.

## What is not known

- The tests used synthetic voices. A real voice in a real room may mishear differently.
- With keywords on, a test recording now and then came back with a changed verb ending ("Open" as "Opened").
  The cause is not established. The check leaves it alone, since it is not a name.
- A wrong saved correction rides into the keyword list like a right one.
  Deleting it from the transcript glossary file removes it at the source.
