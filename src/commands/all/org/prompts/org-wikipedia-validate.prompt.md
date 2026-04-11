---
schema: 0.2.0
description: Validate whether a Wikipedia article matches the target organization
created: 2026-01-26
updated: 2026-01-26
---

You are validating whether a Wikipedia article matches the organization we're looking for.

## Search Context

**Search term:** "{{search.term}}"

{{#if org.name}}
**Organization name:** {{org.name}}
{{/if}}
{{#if org.website}}
**Website:** {{org.website}}
{{/if}}

## Wikipedia Article

**Title:** {{article.title}}
**URL:** {{article.url}}
**Extract:** {{article.extract}}

## Your Task

Determine if this Wikipedia article is actually about the organization we're looking for, based on the context provided (organization name and/or website).

Return a JSON object:
```json
{
  "is_match": true|false,
  "reasoning": "brief explanation"
}
```

## Guidelines

- Return true if the article is clearly about the same organization
- Return false if:
  * The article is about a different organization with a similar name
  * The article is about a person, place, or other entity instead of the organization
  * The article is a disambiguation page
  * The website domain strongly suggests a different entity (e.g., .com website but article is about a geographic location)
- When in doubt, err on the side of false to avoid using incorrect information

Return only valid JSON.
