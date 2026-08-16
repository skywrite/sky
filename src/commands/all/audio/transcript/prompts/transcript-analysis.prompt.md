---
schema: 0.2.0
created: 2026-01-13
updated: 2026-08-16
description: Analyze transcript for transcription errors and clean-up opportunities
---

Analyze this raw transcript and identify issues to fix.

**IMPORTANT**: Your job is to clean up transcription errors and verbal artifacts. Do NOT change formatting, speaker labels, punctuation, or sentence structure. Only fix the specific issues described below.

## Transcript

{{user.input}}

## Known Contacts

The following are known contacts sorted by interaction frequency (most frequent first). The number in parentheses is an interaction score - higher means more relevant.

Use this list for name correction. If a transcribed name **sounds like** a known contact, correct it with HIGH confidence. Phonetic matching is required - transcription often misspells names phonetically (e.g., "Tanesha" → "Tanisha", "Niles Novack" → "Nils Novak"). Check EVERY name in the transcript against this list.

```
{{user.knownPeople}}
```

## Known Organizations

The following are known organizations (companies, etc.) sorted by interaction frequency. Use this list for organization name correction. If a transcribed word **sounds like** a known organization, correct it with HIGH confidence.

Company names are often phonetically transcribed incorrectly.

```
{{user.knownOrgs}}
```

## Known Projects

Project and product names from the user's notebook. Use this list for name correction exactly like the contacts and organizations above: if a transcribed word or phrase **sounds like** a known project, correct it with HIGH confidence.

```
{{user.knownProjects}}
```

## User Glossary (Past Rulings)

Rulings the user has made on previous transcripts, in up to three groups:

- **Confirmed corrections**: when the mishearing — or a close variant — appears and the replacement makes sense in context, correct it with HIGH confidence; do not ask again.
- **Sounds-like hints**: ordinary words the user has previously corrected to an entity name. NEVER rewrite these blindly: correct at HIGH confidence only where the context clearly refers to the entity; leave genuine ordinary-speech uses untouched; when ambiguous, flag at MEDIUM confidence with the hinted entity as `suggestedFix`.
- **Leave as-is**: never flag these terms.

```
{{user.glossary}}
```

## Instructions

Identify issues and assign a confidence level to each:

Keep each issue's `originalText` to the SMALLEST span that contains the error — a word or short phrase. Never flag a whole sentence when one word inside it is the problem; the surrounding sentence belongs in `contexts`, not in `originalText`.

### Auto-fix (confidence: "high") - Applied automatically:

1. **FILLER WORDS**: "um", "uh", "uhh", "umm", "er", "ah", "like" (as filler), "you know", "I mean", "sort of", "kind of" (when meaningless)

2. **STUTTERS**: Repeated words like "I I I think" → "I think", "the the" → "the"

3. **FALSE STARTS**: Abandoned phrases like "We should— actually, let's" → "Actually, let's"

4. **OBVIOUS ERRORS**: Clear mishearings where context makes the correct word unambiguous

### Review needed (confidence: "medium" or "low") - User prompted:

5. **UNCLEAR WORDS**: Transcription errors where the correct word is ambiguous

6. **TECHNICAL TERMS**: Domain-specific vocabulary, acronyms that may be wrong

7. **NAME SPELLING**: Person names, company names, place names. **If a name phonetically matches a known contact, use HIGH confidence and auto-fix.** If a name does NOT match any known contact, use MEDIUM confidence and prompt user to confirm or provide the correct spelling.

8. **INAUDIBLE MARKERS**: `[inaudible]`, `[unclear]`, `[unintelligible]` - flag for user to provide context

9. **CROSSTALK**: `[crosstalk]`, `[overlapping]` - user decides to remove or clarify

### Confidence levels:

- **high**: You're 90%+ sure of the correction. Apply automatically.
- **medium**: You're 60-90% sure. Show suggestion but let user confirm.
- **low**: You're <60% sure or multiple valid options exist. Must prompt user.

## One Issue Per Distinct Problem

Report each distinct problem ONCE — never one issue per instance.

- A term misheard repeatedly ("Novack" 25 times) is ONE issue with `occurrences: 25`; its correction is applied to every instance.
- Repeated fillers work the same way: all the "um"s are ONE issue with an occurrence count. Estimates are fine.
- `contexts` holds 1-3 representative samples. For a one-off issue include the sentence before and after; for a recurring term one sentence per sample is enough.
- Only split the same text into separate issues when different places genuinely need DIFFERENT corrections.

## People Extraction

In addition to issues, extract two lists of people:

1. **who**: People who were PRESENT in the meeting being described. The speaker will typically state explicitly who they met with (e.g., "I had a meeting with Sarah and John").

2. **rel**: People who are MENTIONED or DISCUSSED but were NOT present in the meeting. These are people talked about during the meeting.

Match names against the Known Contacts list when possible. Use the full name from the contacts list (e.g., if "Tanesha" is mentioned and "Tanisha Patel" is in contacts, use "Tanisha Patel").

If no participants or mentioned people can be identified, use empty arrays. Do NOT make up names.

## Output Format

```json
{
  "issues": [
    {
      "type": "filler" | "stutter" | "false_start" | "unclear" | "technical" | "name" | "inaudible" | "crosstalk",
      "confidence": "high" | "medium" | "low",
      "occurrences": 25,
      "originalText": "the smallest span containing the error — a word or short phrase, never a whole sentence",
      "contexts": ["1-3 representative samples, each showing the problem text with enough surrounding words to judge it"],
      "suggestedFix": "corrected text (empty string to remove)",
      "options": ["alternative1", "alternative2"]
    }
  ],
  "summary": "Brief 1-2 sentence description of what this transcript is about",
  "who": ["Person A", "Person B"],
  "rel": ["Person C", "Person D"]
}
```

Be aggressive with high-confidence fixes. The goal is to minimize user prompts while still catching genuinely ambiguous issues.
