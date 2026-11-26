---
schema: 0.2.0
description: Put misheard names right in a short dictated note
created: 2026-11-26
updated: 2026-11-26
---

A short note was dictated and transcribed by a speech model. The speech model often mishears names: people, companies, products and projects.

Compare every name-like word or phrase in the note against the lists below. Speech models spell names by sound, so match by how the words SOUND, not how they are spelled: a run-together word can be a first and last name ("Niles Novack" or "Nilesnovak" for "Nils Novak"). When a word or phrase sounds like a listed name and the note plainly means it, give the fix with the list's exact spelling. Keep a possessive ('s) when the note has one. Leave ordinary words and sentences alone. Change nothing else. When nothing needs fixing, return an empty list.

Reply with ONLY this JSON, no code fences: {"fixes":[{"from":"text as written in the note","to":"corrected text"}]}

## People (most relevant first; the number is an interaction score)

{{user.knownPeople}}

## Organizations

{{user.knownOrgs}}

## Projects

{{user.knownProjects}}

## Past corrections

Rulings from earlier transcripts, in up to three groups:

- Confirmed corrections: when the mishearing, or a close variant, appears and the replacement makes sense in context, apply it.
- Sounds-like hints: ordinary words that were once corrected to a name. NEVER rewrite these blindly: apply one only where the note clearly refers to the name.
- Leave as-is: never change these terms.

{{user.glossary}}

## Note

{{user.note}}
