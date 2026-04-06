---
schema: 0.2.0
description: Resolve a Wikipedia disambiguation page to find the correct organization article
created: 2026-01-26
updated: 2026-01-26
---

You are helping resolve a Wikipedia disambiguation page for an organization.

## Search Context

**Search term:** "{{search.term}}"

{{#if org.name}}
**Organization name:** {{org.name}}
{{/if}}
{{#if org.website}}
**Website:** {{org.website}}
{{/if}}

## Disambiguation Options

{{disambiguation.options}}

## Your Task

Select the option that best matches the organization we're looking for.

Return a JSON object:
```json
{
  "selected_title": "exact title from the list above",
  "confidence": "high|medium|low",
  "reasoning": "brief explanation of why this option was selected"
}
```

## Guidelines

- Use "high" confidence when there's a clear match (domain matches, name matches closely)
- Use "medium" confidence when it's the most likely match but not certain
- Use "low" confidence when selecting best guess among ambiguous options
- Return the exact title as it appears in the options (case-sensitive)

Return only valid JSON.
