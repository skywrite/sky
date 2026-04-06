---
schema: 0.2.0
created: 2026-01-13
updated: 2026-01-26
description: Apply transcription corrections and add natural paragraph breaks
---

Apply the following corrections to this transcript and add natural paragraph breaks.

## Original Transcript

{{user.input}}

## Corrections to Apply

{{user.corrections}}

## Output Requirements

1. **Apply corrections**: Replace the words listed in the corrections
2. **Add natural paragraph breaks**: Insert blank lines between paragraphs where there are natural topic shifts or pauses in the conversation. A transcript that is one giant wall of text is hard to read - break it into digestible paragraphs.
3. **No additions**: Do NOT add speaker labels, timestamps, headers, bullet points, or markdown formatting
4. **Clean output**: Return only the corrected transcript text, no code fences or explanations

The goal is a clean, readable transcript with natural paragraph breaks - not a wall of text, but also not overly formatted.
