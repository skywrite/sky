---
schema: 0.2.0
created: 2026-05-04
description: Generate a freestyle summary from a notes/journal transcript
---

Summarize the following notes from dictated audio transcription.

## Context

- These notes are from audio dictation, NOT written text
- The transcript contains no spelling errors or name errors
- Do not ask clarifying questions - proceed directly to summarization
- Content varies — could be quick task captures, ideas, observations, or journal-style reflection. Adapt structure to fit.
- The speaker is {{me.fullName}}, {{me.title}} of {{me.company}}

## Transcript

{{user.input}}

## Output Format

- Use `###` (h3) headers only. NEVER use `##` (h2) — those are reserved for the parent document.
- Begin with `### Title` (5-7 words capturing what the note is about).
- After Title, choose your own sections based on what's actually in the content. Group related thoughts naturally. Do not invent categories that aren't there.
- Capture everything mentioned; skip only filler and tangents.

## Guidelines

- Be concise and faithful — no padding
- Do not use tables
- Keep key quotes in "quotes"
- Preserve specific names, dates, numbers, and technical terms exactly
- Match the tone of the source: terse for quick captures, reflective for journal-style content
- If the note is short, the summary should be short — don't pad to look thorough
