---
schema: 0.2.0
description: Split a spoken journal transcript into topical sections and write a summary, without altering the speaker's words
created: 2026-08-11
updated: 2026-08-11
---

Below is what {{me.firstName}} said while recording a spoken journal entry on {{journal.date}}. It arrives as one unbroken block of speech.

Your job is to make it readable without making it yours. Three things only:

1. Give the entry a short title.
2. Write a short summary of what the entry covers.
3. Break the speech into topical sections, each with a heading.

## The rule that matters most

**Do not change the words.** This is a journal, and its whole value is that it
records what was actually said. You are inserting headings and paragraph breaks
into existing text — nothing else.

Specifically, you must not:

- Reword, paraphrase, tighten, or "clean up" any sentence
- Reorder anything: sections appear in the order they were spoken
- Delete content, including tangents, repetition, false starts, and trailing off
- Add transitions, commentary, conclusions, or any sentence that was not spoken
- Correct grammar, or turn spoken fragments into complete sentences
- Change person, tense, or tone

Verbatim means verbatim. If a passage rambles, it stays rambling. If the speaker
contradicts themselves, both halves stay. The one edit you may make is inserting
paragraph breaks within a section where the speech clearly moves on.

## Sections

Start a new section where the subject genuinely changes — a different project,
person, worry, or decision. Do not split a single train of thought just to make
sections shorter, and do not merge two unrelated subjects to make them longer. A
short entry may be a single section; a long one may be eight.

Heading rules:

- Use `##` for every section heading.
- Name each heading after what is actually discussed in that section, using the
  speaker's own vocabulary — a concrete noun phrase like `## The Atlas launch date`
  or `## Feeling behind on hiring`, never a generic label like `## Reflections` or
  `## Thoughts`.
- **No heading may contain the word "transcript"**, in any form or casing. A heading
  containing it causes everything beneath it to be silently dropped when this file
  is read back later.
- Do not number the headings.

## Output format

Return markdown only — no code fences, no preamble, no frontmatter, and no level-one
heading. The first line is the title, on its own, in exactly this form. Then the
summary, then the sections:

```
TITLE: Five To Seven Words In Title Case

## Summary
Two or three sentences describing what this entry covers.
This is the one place you write rather than reproduce.

## <first topic>
<the speaker's words, verbatim>

## <second topic>
<the speaker's words, verbatim>
```

The title names what the entry is *about* — the thematic or emotional heart of it,
in the speaker's own terms, five to seven words in Title Case. It becomes the
filename, so make it something recognisable months later: `Doubting The Atlas
Timeline` rather than `Video Journal Entry`.

The title and summary are the only prose you author. Everything after them belongs
to the speaker.

## What was said

{{journal.transcript}}
