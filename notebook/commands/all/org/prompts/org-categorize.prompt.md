---
schema: 0.2.0
description: Categorize an organization using taxonomy and enrichment sources
created: 2026-01-26
updated: 2026-01-26
---

You are an expert at categorizing organizations. Analyze the following organization and determine the most appropriate sector and subcategory.

## Organization Information

{{#if source.webFetch}}
### Website Source
- URL: {{source.webFetch.website}}
- Name: {{source.webFetch.name}}
- Summary: {{source.webFetch.summary}}
{{/if}}

{{#if source.wikipedia}}
### Wikipedia Source
- Article: {{source.wikipedia.title}}
- URL: {{source.wikipedia.url}}
- Extract: {{source.wikipedia.extract}}
- Selection Confidence: {{source.wikipedia.confidence}}
- Selection Reasoning: {{source.wikipedia.reasoning}}
{{/if}}

## Existing Taxonomy (for reference)

{{taxonomy.content}}

## Your Task

Determine the most accurate sector and subcategory for this organization. The taxonomy above is a REFERENCE, not a constraint. If existing categories don't accurately represent the organization, you should suggest a NEW, more appropriate category.

Return a JSON object with the following structure:
```json
{
  "primary_sector": "sector name (lowercase)",
  "primary_subcategory": "subcategory name (lowercase)",
  "is_new_category": true/false,
  "category_reasoning": "Explanation of category choice and why new category is needed if applicable",
  "confidence": "high|medium|low",
  "kind": "company|government|nonprofit|unknown",
  "ticker": "EXCHANGE:SYMBOL (optional, only if publicly traded)",
  "website": "https://example.com (optional, official website URL)",
  "description": "3-5 sentence summary with paragraph breaks between logical sections"
}
```

## Guidelines

- **IMPORTANT**: The taxonomy is a guide, NOT a limitation. Create new categories when needed for accuracy.
- **When to create new categories**: If the organization doesn't clearly fit existing categories, or if putting it in an existing category would be misleading or inaccurate, suggest a new sector/subcategory that better represents what the organization actually does.
- **Examples of when to create new categories**:
  - Marriott → "hospitality/hotels" (NOT "merchants/retail")
  - Hilton → "hospitality/hotels" (NOT "merchants/retail")
  - Delta Airlines → "transportation/airlines" (NOT "merchants/marketplaces")
  - Netflix → "media/streaming-tv" (if this doesn't exist, create it)
- Use existing taxonomy categories when they're genuinely appropriate
- Analyze ALL available sources (website and/or Wikipedia) to make the best determination
- If Wikipedia confidence is "high", give more weight to Wikipedia information
- Set "is_new_category" to true if suggesting a sector/subcategory combination not in the taxonomy
- In "category_reasoning", explain why you chose this category. If it's new, explain why existing categories don't fit.
- Return sector and subcategory in lowercase with hyphens (e.g., "hospitality", "hotels", "streaming-tv")
- Confidence should be "high" if the categorization is clear from the sources, "medium" for reasonable inference, "low" for uncertain cases
- Kind should be "company" for for-profit businesses, "government" for government entities, "nonprofit" for non-profits, or "unknown" if unclear
- Ticker format examples: "NYSE:EXOD", "NASDAQ:COIN", "TSX:SHOP" - only include if the organization is publicly traded
- If no ticker is found or organization is not publicly traded, omit the ticker field
- Website should be the official website URL if found in the content
- If website is already provided in the Website Source, you can use that URL
- If no website is found, omit the website field
- Description should be a concise 3-5 sentence summary that captures: (1) what the organization does, (2) when it was founded and by whom (if known), (3) scale/market position, and (4) key products or distinguishing features
- **IMPORTANT**: Format the description with paragraph breaks at natural points using `\n\n` in the JSON string (e.g., "What they do and founding.\n\nScale and market position.\n\nKey products.")
- The description should be written in a neutral, encyclopedic tone

Return only valid JSON.
