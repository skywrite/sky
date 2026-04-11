---
schema: 0.2.0
description: Select the correct Wikipedia article from search results for an organization
created: 2026-01-26
updated: 2026-01-26
---

You are helping select the correct Wikipedia article for an organization.

## Search Context

**Search term:** "{{search.term}}"

{{#if org.name}}
**Organization name:** {{org.name}}
{{/if}}
{{#if org.website}}
**Website:** {{org.website}}
{{/if}}

## Wikipedia Search Results

{{search.results}}

## Your Task

Select the Wikipedia article that best matches the organization we're looking for.

Consider:
- Organization name similarity
- Website domain relevance (if provided)
- Description content (companies vs places vs people vs other entities)
- Common sense (e.g., a .com website probably refers to a company, not a geographic location)

Return a JSON object:
```json
{
  "selected_title": "exact title from the list above",
  "confidence": "high|medium|low",
  "reasoning": "brief explanation of why this article was selected"
}
```

## Guidelines

- Use "high" confidence when there's a clear match (domain matches, name matches closely)
- Use "medium" confidence when it's the most likely match but not certain
- Use "low" confidence when selecting best guess among ambiguous options
- Return the exact title as it appears in the results (case-sensitive)

Return only valid JSON.
