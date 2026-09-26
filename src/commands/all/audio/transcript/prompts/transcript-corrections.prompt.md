---
schema: 0.2.0
created: 2026-09-26
updated: 2026-09-26
description: Read the owner's line at the write-up check into the fields it changes and the renames it asks for
---

The notebook owner checked a write-up and the fields read out of it, and typed what is wrong.
Read their line into the fields it changes and the renames it asks for.

## The fields as they stand

- title: {{check.title}}
- time: {{check.time}}
- durationMinutes: {{check.duration}}
- medium: {{check.medium}}
{{check.people}}
- rel: {{check.rel}}

Today's date: {{check.today}}

## Field rules

- Return only the fields the owner changed.
- time is "YYYY-MM-DD HH:MM", zero-padded.
- A date given without a year resolves to its most recent occurrence on or before today's date. Never invent a year.
- Hours are NOT capped at 23. Notebook time files late-night work under the day it started, so "25:30" means 01:30 the next morning and is a deliberate, valid value. Copy such times through exactly — never normalize them, never roll the date forward, never report them as invalid or ask the owner to clarify them.
- durationMinutes is a number: "13 mins" is 13.
{{check.peopleRules}}

## Renames

A rename is the owner saying a name or a term is spelled wrong in the words: "it's not Pria, it's Priya", "Pria → Priya", "her name is spelled Priya". Return one only when they say so.

- `right` is the spelling the owner gave, exactly as typed.
- `wrong` lists every spelling the write-up below uses for that same name or term: the one the owner named, and any other it treats as the same, such as a spelling it notes as "also transcribed as". Copy each exactly as the write-up spells it.
- A rename changes no field. Sky carries it into the people fields itself.
- A field correction is never a rename. "rel: Sam, Jo" corrects a list; it renames nobody.
- A fact is never a rename. "It was 95%, not 90%" changes no spelling.

## Output

Return ONLY a JSON object with the fields that change, and `renames` when there are any. Examples:

- "Time: 2026-01-27 8:44, duration: 13 mins, Medium: Phone" → {"time": "2026-01-27 08:44", "durationMinutes": 13, "medium": "Phone"}
- "time: 2026-03-31 25:30" → {"time": "2026-03-31 25:30"}
- "It's not Pria, it's Priya" → {"renames": [{"wrong": ["Pria"], "right": "Priya"}]}
- "medium is Phone, and Prya is Priya" → {"medium": "Phone", "renames": [{"wrong": ["Prya"], "right": "Priya"}]}

## The write-up

{{check.writeup}}

## The owner's line

{{check.corrections}}
