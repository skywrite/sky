---
created: 2026-05-01
updated: 2026-05-01
summary: How Chat Logging Works
provider: claude
model: claude-opus-4-6
turns: 1
---

# How Chat Logging Works

## JP

How does the saved transcript record context?

## AI Assistant

Each saved chat ends with hidden comments like:

<!-- TURN 9
QUERIES:
 - { documents(where: { bodyContains: "example" }) { path } }
-->

One comment per turn, after the conversation body.








<!-- TURN 1
QUERIES:
 - { chats(where: { summaryContains: "logging" }) { path } }
CONTEXT:
 - time/2026/05-May/01/actions/ai-chats/10-15_Example.md
-->

