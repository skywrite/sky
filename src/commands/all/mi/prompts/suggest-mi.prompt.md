---
name: suggest-mi
schema: 0.2.0
created: 2026-01-26
updated: 2026-08-17
description: Suggest 3 specific, actionable Most Important items based on day context
---

Today is {{context.notebookDate}} ({{user.dayOfWeek}}).{{#if user.time}} Current time: {{user.time}} ({{user.timeOfDay}}) — suggest only what can still be completed in the remaining day.{{/if}}

You are advising {{me.fullName}}, {{me.title}} of {{me.company}} ({{me.companyDescription}}).

Suggest THREE specific, actionable items for the Most Important focus today. **Bias heavily toward accomplishing goals** — cross-reference the user's active goals and prioritize actions that make concrete progress toward them. Every suggestion must pass the 10x filter: "Does this move {{me.company}} toward 10x?"

## What Makes a Good MI

A good Most Important item is:
- **An ACTION** - starts with a verb (Decide, Write, Call, Send, Complete, Schedule, Review)
- **SPECIFIC** - names the exact thing (not "work on deals" but "Send Atlas term sheet to legal")
- **COMPLETABLE TODAY** - can be done in 1-4 hours of focused work
- **OUTCOME-ORIENTED** - describes the end state, not the activity

## Bad vs Good Examples

❌ "Focus on Team X salary decisions" (too broad, no action)
✅ "Decide Team X salary freeze: approve/reject with email to HR by 3pm"

❌ "Handle Jane situation" (unclear action)
✅ "Send Jane reoffer email with clear 90-day expectations"

❌ "Think about Atlas deal" (not actionable)
✅ "Draft Atlas term sheet counter-proposal for Devon's review"

❌ "Complete 8-mile walk" (routine maintenance, not MI-worthy)
✅ "Schedule overdue colonoscopy before insurance deadline Friday"

## Health Priority Rules

**Routine health is NOT Most Important material:**
- Daily walks, gym sessions, meal tracking
- Regular sleep schedules
- Ongoing fitness goals

**Urgent/serious health CAN be Most Important:**
- Deferred medical tests or appointments (bloodwork, screenings)
- Symptoms that need investigation
- Health deadlines (insurance, prescription refills)
- Health issues actively blocking work or life

## Context

Goals, pending decisions, this week's plan, and the last 7 days: journal entries, most-important files (with completion state), and a daily summary per day (today appears as its raw day ledger — schedule, reminders, todos).

{{user.dayContext}}

---

First, write a 1-2 line `contextSummary` that captures the key themes and pressures from the context above. This will be displayed to the user above the suggestions.

Then generate 3 suggestions. Each must:
1. Start with an action verb
2. Name the specific deliverable or outcome
3. Be completable in one focused work session today
4. Reference actual items from the context above
5. Pass the 10x filter

Make the 3 options diverse, but **always anchor at least one suggestion to an active goal**:
- One **goal-advancing** (the single highest-leverage action that moves a goal forward today)
- One **urgent/tactical** (deadline-driven, blocking others)
- One **strategic/important** (high-leverage decision or action)

If a goal has a deadline approaching, prioritize it. If multiple goals are active, pick the one where today's action has the most impact.

Only include health if it's urgent/serious per the rules above.
