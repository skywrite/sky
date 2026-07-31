---
schema: 0.2.0
created: 2026-01-13
updated: 2026-07-29
description: Apply transcription corrections and add natural paragraph breaks
---

Apply the following corrections to this transcript and add natural paragraph breaks.

## Original Transcript

{{user.input}}

## Corrections to Apply

{{user.corrections}}

## Known Contacts (Reference Only)

Canonical spellings of known people, for reference while rewriting. Wherever the transcript or an applied correction yields one of these names, reproduce it exactly as spelled here — never drift to another spelling. Do NOT introduce new corrections from this list; only the corrections listed above may change words.

```
{{user.knownPeople}}
```

## Known Organizations (Reference Only)

The same rules apply to these organization names.

```
{{user.knownOrgs}}
```

## Known Projects (Reference Only)

The same rules apply to these project names.

```
{{user.knownProjects}}
```

## Output Requirements

1. **Apply corrections**: Replace EVERY occurrence of each listed `originalText` — a correction applies transcript-wide, and its `occurrences` count says how many instances to expect
2. **Add natural paragraph breaks**: Insert blank lines between paragraphs where there are natural topic shifts or pauses in the conversation. A transcript that is one giant wall of text is hard to read - break it into digestible paragraphs.
3. **No additions**: Do NOT add speaker labels, timestamps, headers, bullet points, or markdown formatting
4. **Clean output**: Return only the corrected transcript text, no code fences or explanations

The goal is a clean, readable transcript with natural paragraph breaks - not a wall of text, but also not overly formatted.
