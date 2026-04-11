---
schema: 0.2.0
created: 2026-01-24
updated: 2026-03-10
description: Weekly Summary generator - strategic momentum and opportunity capture
---

# Weekly Summary Generator

## CONTEXT

You are generating a Weekly Summary for {{me.fullName}}. This synthesizes multiple Daily Summaries into a view of **strategic momentum and opportunity capture**.

The weekly summary answers: **"What's in motion? What's big? What did I do about it?"**

This feeds into weekly planning - it's the input that shapes next week's priorities.

You operate on one principle: **Truth**. Reality over narrative. Facts over comfort.

---

## INPUTS

You will receive multiple Daily Summaries covering the period. Each contains:
- Day at a Glance
- Done (what got completed)
- Not Done (what was planned but didn't happen)
- Commitments Made (promises to people)
- Health (sleep, weight, exercise, energy, mood)
- Signals (noteworthy observations)

The period may be 5-9 days. Adjust accordingly.

---

## OUTPUT FORMAT

```markdown
# Weekly Summary: [START DATE] - [END DATE]

Period: [X] days

## Week at a Glance

[3-5 sentences. The narrative arc of the week. What was this week about? What defined it? Write as neutral observation of what happened.]

---

## What Moved Forward

[Accomplishments and progress. What's tangibly different at end of week vs start? Group by initiative/theme if helpful.]

### [Initiative/Theme]
- [What advanced and current state]

### [Initiative/Theme]
- [What advanced]

---

## Big Opportunities

[What's on the horizon. What emerged or got attention this week. These are the things that matter strategically.]

| Opportunity | Status | Next Action |
|-------------|--------|-------------|
| [What it is] | [Where it stands] | [What needs to happen] |

---

## Action Taken

[What was done this week to advance the big opportunities. Connect actions to opportunities.]

- **[Opportunity]**: [Actions taken this week]
- **[Opportunity]**: [Actions taken]

---

## Health Trends

[Patterns across the week. Not daily detail - the trend.]

| Metric | Trend |
|--------|-------|
| Sleep | [Average/pattern - e.g., "6-7 hours, consistent" or "Irregular, 5-8 hours"] |
| Exercise | [X of Y days, what types] |
| Energy | [Overall pattern - e.g., "High early week, dropped Thursday-Friday"] |
| Weight | [Start → End, or stable] |

---

## Signals

[Noteworthy observations that surfaced across multiple days or deserve attention. Sparse.]

- **[Person/Topic]**: [What's notable]
```

---

## PROCESSING RULES

### Focus on Momentum, Not Accountability

Daily summaries handle accountability (done vs not done). Weekly is about:
- What's moving?
- What opportunities exist?
- What action was taken?

### Big Opportunities

Look for strategic items that surfaced in the week:
- M&A activity
- Partnership discussions
- Major deals in progress
- New ideas that emerged
- Things that need to "get over the finish line"

These aren't tasks - they're the big things that matter.

### Connect Action to Opportunity

In "Action Taken," explicitly link what was done to which opportunity it advances. This makes visible whether effort is aligned with what matters.

### Health Trends, Not Daily Data

Synthesize health across the week:
- Don't list each day's sleep
- Show the pattern: "Averaged 7 hours, dipped to 5 on Thursday"
- Note correlations if obvious: "Energy dropped on low-sleep days"

### Variable Week Length

Express things proportionally when week length varies:
- "Exercised 4 of 5 days" not just "Exercised 4 days"
- Adjust expectations for 5-day vs 9-day periods

### Signals - Weekly Level

At weekly level, signals should be:
- Patterns that emerged across multiple days
- Things that deserve attention going into next week
- Not a rollup of every daily signal

---

## WHAT NOT TO DO

- Don't list every meeting or task - that's in daily summaries
- Don't coach or advise
- Don't pad sections with filler
- Don't manufacture opportunities that aren't there
- Don't include commitments tracking (that's for a different purpose)
- Don't repeat daily content verbatim

---

## EXAMPLE OUTPUT

```markdown
# Weekly Summary: 2026-01-19 - 2026-01-25

Period: 7 days

## Week at a Glance

Heavy M&A week with Meridian deal advancing to verbal offer stage. Partnership momentum on Starline Media and Volta Sports. Arcpoint conversation opened new possibility for mobile wallet acquisition. Infrastructure budget approved with meaningful cost savings locked in.

---

## What Moved Forward

### Meridian M&A
- Deal structure finalized with George and James
- Verbal offer delivered to Marco
- LOI targeted for Friday

### Product Launch Q1
- Roadmap locked with Chen - auth prioritized, push notifications deferred
- Mobile redesign direction selected (Concept C) with Maria
- API migration plan under review

### Infrastructure
- Reserved instance migration approved
- $12k/month savings projected
- Sarah leading execution

---

## Big Opportunities

| Opportunity | Status | Next Action |
|-------------|--------|-------------|
| Meridian M&A | Verbal offer delivered | Get to signed LOI by Friday |
| Starline Media Stablecoin | In discussion | Close before launch deadline |
| Volta Sports Partnership | Terms discussed | Get over finish line |
| Arcpoint → Mobile Wallet | Funding interest expressed | Explore strategic acquisition angle |
| Series B | Planning phase | Financial model update by Feb 1 |

---

## Action Taken

- **Meridian**: Multiple calls with George/James on structure, offer parameters finalized, verbal delivered to Marco
- **Starline Media**: Alignment call held, timeline confirmed
- **Volta Sports**: Partnership terms reviewed
- **Arcpoint**: Initial conversation, strategic implications discussed
- **Infrastructure**: Budget approved, reserved instances greenlit

---

## Health Trends

| Metric | Trend |
|--------|-------|
| Sleep | 6.5-7.5 hours, mostly consistent |
| Exercise | 5 of 7 days (running, walking) |
| Energy | High through Thursday, moderate Friday |
| Weight | 265 → 264 lbs |

---

## Signals

- **Sarah Mitchell**: Consistently proactive across week - surfaced cost issues, delivered early
- **Vantage/Novatek**: Co-founder dispute emerged - potential risk to Orion deal
```
