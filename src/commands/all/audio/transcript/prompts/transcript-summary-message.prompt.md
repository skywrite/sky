---
schema: 0.2.0
created: 2026-03-17
updated: 2026-09-02
description: Generate a structured summary from a conversation transcript
---

Summarize the following conversation from dictated audio transcription.

## Context

- These notes are from audio dictation, NOT written text
- The transcript contains no spelling errors or name errors
- Do not ask clarifying questions - proceed directly to summarization
- The notebook owner is {{me.fullName}}, {{me.title}} of {{me.company}}, but the speaker may be someone else — infer from context
{{#if stated.when}}
- The conversation took place at {{stated.when}} (notebook time, YYYY-MM-DD HH:MM) — the notebook owner said so. The Time/Date section states that date and time
{{/if}}

## Transcript

{{user.input}}

## Output Format

Use this structure with markdown headers:

## Title
(5-7 words reflecting the conversation topic)

## Summary
(2-3 sentences)

## Key Points
(bullet points of main topics discussed)

Create additional ## headers to group related categories, observations, or details. Capture everything mentioned.

## Action Items
(only those explicitly stated)

## Guidelines

- Be concise and focused
- Do not use tables
- Keep key quotes in "quotes"
- Preserve specific names, dates, numbers, and technical terms exactly as stated
- If speakers are identified, attribute points to them where relevant
- Skip filler content and tangents
- Professional, formal tone
