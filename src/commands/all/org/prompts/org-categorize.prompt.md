---
schema: 0.2.0
description: Categorize an organization using taxonomy and enrichment sources
created: 2026-01-26
updated: 2026-08-13
---

You are an expert at categorizing organizations. Analyze the following organization and determine the most appropriate sector and subcategory.

## Organization Information

- Name: {{org.name}}

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

## Categories Currently In Use

Every sector/subcategory pair that exists in the notebook right now. Prefer one of these when it genuinely fits; a pair outside this list is a new category.

{{taxonomy.inUse}}

## Your Task

Determine the most accurate sector and subcategory for this organization, plus the metadata fields described below. The taxonomy above is a reference, not a constraint: use an existing category when it genuinely fits, and propose a new sector or subcategory when forcing the organization into an existing one would be misleading — a hotel chain belongs in hospitality/hotels even if no hospitality sector exists yet, not in merchants/retail; a streaming service belongs in media/streaming-tv, not merchants/marketplaces.

## Guidelines

- Weigh ALL available sources (website and/or Wikipedia); if the Wikipedia selection confidence is "high", give its content more weight
- If no website or Wikipedia source is available, categorize from your own knowledge of the named organization — and if you don't recognize it, say so via low confidence rather than guessing details
- primary_sector / primary_subcategory: lowercase with hyphens (e.g., "hospitality", "hotels", "streaming-tv")
- is_new_category: true when the sector/subcategory pair is not in the Categories Currently In Use list
- category_reasoning: why this category — and, if new, why the existing ones don't fit
- confidence: "high" when the categorization is clear from the sources, "medium" for reasonable inference, "low" for uncertain cases
- kind: "company" for for-profit businesses, "government" for government entities, "nonprofit" for non-profits, "unknown" if unclear
- ticker: EXCHANGE:SYMBOL (e.g., "NASDAQ:COIN", "TSX:SHOP") only when the organization is publicly traded and the sources or certain knowledge confirm the ticker — never guess; omit otherwise
- website: the official website URL (reuse the Website Source URL when present); omit if none is evident
- description: a concise 3-5 sentence summary in a neutral, encyclopedic tone covering what the organization does, its founding (when and by whom, if known), scale or market position, and key products or distinguishing features. Write it as a single flowing paragraph built on concrete facts from the sources — no marketing adjectives or unverifiable superlatives.
