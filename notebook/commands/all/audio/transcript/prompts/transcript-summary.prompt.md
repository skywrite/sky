---
schema: 0.2.0
created: 2026-01-15
updated: 2026-01-26
description: Generate a structured summary from a meeting transcript
---

Summarize the following meeting notes from dictated audio transcription.

## Context

- These notes are from audio dictation, NOT written text
- The transcript contains no spelling errors or name errors
- Do not ask clarifying questions - proceed directly to summarization
- The speaker is {{me.fullName}}, {{me.title}} of {{me.company}}

## Transcript

{{user.input}}

## Output Format

Use this structure with markdown headers:

## Title
(5-7 words reflecting content only - not attendees, location, or meeting medium)

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

## Action Items
(only those explicitly stated by the speaker)

## Important Questions
(notable questions raised during the meeting and who asked them)

## Guidelines

- Be concise and focused
- Do not use tables
- Keep key quotes in "quotes"
- Preserve specific names, dates, numbers, and technical terms exactly as stated
- If speakers are identified, attribute points to them where relevant
- Skip filler content and tangents
- Professional, formal tone
