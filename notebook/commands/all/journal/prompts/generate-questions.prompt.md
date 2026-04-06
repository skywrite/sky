---
schema: 0.2.0
description: Generate 10 contextual journal questions based on recent notebook activity
created: 2026-02-28
updated: 2026-02-28
---

Today is {{journal.date}} ({{journal.dayOfWeek}}).{{#if journal.time}} Current time: {{journal.time}} ({{journal.timeOfDay}}).{{/if}}

Generate 10 journal questions based on the context below.
Each question should be specific and actionable, referencing actual items from the context.
Assign each question to the most appropriate journal type.

Journal types and what they cover:
- Accountability: follow-up on commitments, did you do what you said? hold yourself to promises
- Execution: ANY question about actions, plans, decisions, tasks, priorities, what you'll DO about something
- Health: sleep, weight, exercise, energy, physical wellbeing (reflection, not action plans)
- Mood: emotional state, how you're FEELING - NOT what you'll do about it (that's Execution)
- Relationships: people, interactions, connections
- Leadership: team dynamics, management style, influence (reflection, not action items)
- Gratitude: appreciation, positive observations
- Lessons Learned: insights, mistakes, growth
- Self Improvement: habits, skills, personal development
- Values: alignment with principles, integrity
- Markets: investments, financial reflections
- News: current events, industry news
- Surprises: unexpected events
- Misc: anything else

IMPORTANT: At least 2-3 of your 10 questions MUST use a NEW category that is NOT in the list above.
Invent a category name that captures a specific theme from the context (e.g., Parenting, Legal, Deals, Strategy, Fundraising, Culture, Hiring).
Use a short, capitalized name. Do NOT force-fit everything into the predefined types.

IMPORTANT: If a question asks "what will you DO" or "what actions will you take", it belongs in Execution,
even if the topic is about mood, relationships, or work. Mood/Relationships/etc are for REFLECTION, not action planning.

EXCEPTION: Health is different - ALL health questions (reflection AND action) belong in Health.
Health is a unified journal for physical wellbeing, including plans to improve it.

## Context

{{journal.contextMarkdown}}

---

Guidelines:
- Reference specific items from the context (names, tasks, metrics)
- Look for patterns across the last 7 days (recurring themes, unresolved issues, mood trends)
- If recent days had incomplete tasks, ask about them
- If there are old pending decisions (>7 days), prompt for action
- If health data shows patterns (poor sleep, no exercise), ask about it
- Notice what topics appear repeatedly in journal entries — probe deeper
- Monday: planning/energy tone
- Friday: reflection/wind-down tone
- Morning: forward-looking, planning tone ("what will you..." / "how will you...")
- Afternoon: mid-day check-in tone ("how is today going..." / "what progress...")
- Evening: reflective, review tone ("what did you..." / "how did today go..." / "what did you learn...")
- Be direct and specific, not generic
