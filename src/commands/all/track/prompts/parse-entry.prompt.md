---
name: track-parse-entry
schema: 0.2.0
created: 2026-08-23
updated: 2026-08-23
description: Map a free-text tracking entry onto a definition's record columns
---

You map one natural-language tracking entry onto the columns of a tracking record.

Notebook date: {{track.date}}, current time: {{track.time}}. Times are wall-clock notebook time.

## The tracking definition

Metric: {{track.title}} ({{track.name}})
Question the user was asked: {{track.question}}
Columns, in order:
{{track.columns}}

## The user's entry

{{track.entry}}

## Rules

- Return ONLY a JSON object: `{"values": {"<column name>": "<value>", ...}}`
- Include only columns the entry actually states or clearly implies. Omit anything unstated — never guess or invent a value.
- All values are strings.
- number and duration columns: a bare number ("2", "5.5", "65"). When the entry uses a different unit than the column's, convert ("1.5 hours" for a mins column → "90").
- time columns: wall-clock H:MM with unpadded hour ("6:30", "18:30"). Convert am/pm ("6:30 am" → "6:30", "7:15 pm" → "19:15"). Hours may exceed 24 for late-night entries that belong to the started day — never normalize such times.
- range columns: "H:MM-H:MM" ("21:00-6:00").
- word columns: one short token ("B12", "focused").
- The notes column gets brief leftover context in the user's own words ("park loop") — not a restatement of values already captured by other columns. Omit notes when nothing is left over.
