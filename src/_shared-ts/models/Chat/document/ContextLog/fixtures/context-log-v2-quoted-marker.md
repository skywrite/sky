---
created: 2026-06-03
updated: 2026-06-03
summary: Explaining The Context Log
provider: claude
model: claude-opus-4-6
turns: 1
---

# Explaining The Context Log

## JP

How does the saved log format work?

## AI Assistant

Each transcript ends with a comment that opens with

<!-- CONTEXT-LOG

on its own line, then version and turns as JSON.


<!-- CONTEXT-LOG
{
  "version": 2,
  "turns": [
    {
      "turn": 1,
      "queries": [
        "{ chats(where: { summaryContains: \"log format\" }) { path } }"
      ],
      "stats": {"kept":1,"pruned":0,"excluded":0,"docTokens":400},
      "universe": [
        {"path":"projects/Atlas/notes.md","score":4.2,"tokens":400}
      ]
    }
  ]
}
-->
