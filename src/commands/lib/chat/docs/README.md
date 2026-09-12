---
created: 2026-09-10
updated: 2026-09-11
---

# Chat prompt and tools

`src/commands/lib/chat/` holds what every chat host shares: the system
prompt (`prompts/chat.prompt.md`, rendered once per session by
`systemPrompt.ts` with the people list, standing memory, and the About me
profile) and the notebook, file, and web tools. The engine, session, store,
and context pipeline are documented in
[the Chat model](../../../../_shared-ts/models/Chat/docs/README.md); the web
host in [the chat handler](../../../../service/handler/chat/docs/README.md).

Research inherits standing instructions and the current reading budget; its
bounded tool results and model requests are described in
[research context limits](../../../all/ai/research/docs/README.md).

## What the prompt rules on

- Time: notebook days run past midnight; the newest message stamp is "now".
- Coverage: an empty result describes the record, never the world.
- Evidence grades: the user now, then captured words and actions, then the
  user's turns in past chats, then Sky's own past turns and memory notes.
  A saved chat is past output, never evidence about a person or event.
- Assessing people: what they said or did with source, the strongest
  contrary facts, observed versus inferred, no supplied motives. A
  diagnosis in the question is tested before the response to it is judged.
- Output: ASCII, short sentences, no banned devices, drafts as blockquotes.

## Notes

- Test the premise before the response, and weigh saved chats as past output:
  [2026-09-10 — past chats are not evidence](2026-09-10-past-chats-are-not-evidence.md)
