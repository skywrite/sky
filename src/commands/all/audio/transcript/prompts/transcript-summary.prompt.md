---
schema: 0.2.0
created: 2026-01-15
updated: 2026-09-02
description: Generate a structured summary from a meeting transcript
---

Summarize the following meeting notes from dictated audio transcription.

## Context

- These notes are from audio dictation, NOT written text
- The transcript contains no spelling errors or name errors
- Do not ask clarifying questions - proceed directly to summarization
- The speaker is {{me.fullName}}, {{me.title}} of {{me.company}}
{{#if stated.when}}
- The meeting began at {{stated.when}} (notebook time, YYYY-MM-DD HH:MM) — the speaker said so. The Time/Date section states that date and time; the transcript's own clock, if it has one, counts from it
{{/if}}

## Transcript

{{user.input}}

## Output Format

Use this structure with markdown headers. Begin with the meeting title as a single top-level `#` heading — the title text itself, not the literal word "Title" (e.g. `# Renewal Terms for the Acme Account`). Every other section is a `##` heading beneath it:

# <title — 5-7 words reflecting content only, not attendees, location, or meeting medium>

## Time/Date

## Attendees

## Meeting Summary
(2-3 sentences)

## Purpose
(only include if explicitly stated)

## Context
(only include if explicitly stated)

Create additional ## headers to group related categories, misc points, observations, facts, or opinions. Capture everything mentioned.

## Decisions
(only include if explicitly stated)

## Action Items (me)
(Only items explicitly stated — never inferred, and only ones the speaker is responsible for. One imperative bullet each, with a due date or timeframe if one was mentioned. An item the speaker shares with someone else belongs here, with the co-owner named. Omit this section when there are none.)

## Action Items (others)
(Items owned by anyone other than the speaker, same rules. Name the owner in each bullet. When the owner is unclear, put the item here and note that. Omit this section when there are none.)

## Important Questions
(notable questions raised during the meeting and who asked them)

## Loose Ends
(Anything ambiguous, or where you can't tell whether it was a decision or just thinking aloud. Preserve it here verbatim rather than dropping it or resolving it yourself. Omit this section only if nothing is unclear.)

## Guidelines

- Capture every fact, figure, name, date, decision, and commitment — omit nothing substantive. Concision is about wording, not coverage.
- Keep prose tight: don't pad, restate the transcript, or editorialize.
- Preserve specific names, dates, numbers, and technical terms exactly as stated
- Attribute points, decisions, and questions to the person who made them when stated
- Keep key quotes in "quotes"; do not use tables
- Skip verbal filler and repetition — but never content
- Output only the structured notes: no preamble or closing remarks
- Clear, direct, plain language — these are personal notes, not a formal document
