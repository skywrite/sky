---
created: 2026-09-10
updated: 2026-11-03
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

Web page snapshots, section reads, and continuation positions follow the
[shared web reader contract](../../web/docs/README.md).

Explicit requests to remember use `memoryTools.ts` in both full chat hosts and persist during the current turn.
See the [memory store's write contract](../../../../_shared-ts/models/Memory/docs/README.md#write-side).

## Local file organization

The terminal and web chat, including voice, use `createChatFileTools` for reading documents,
writing text files, listing folders, creating folders, and moving files or folders.
The browser task retains `createFileTools`, its restricted document reader; adding a chat capability must not expand
the private browser worker's filesystem access.
Already requested folder changes run directly through structured tools.

`write_file` saves exact UTF-8 text at a requested path and creates missing parents.
It stages and verifies the bytes on the destination volume before exclusively linking the complete file into place.
Existing files, directories and symlinks are never replaced, including when writers race for the same name.
An interrupted write publishes no partial destination; temporary-copy cleanup problems are reported separately.

`find_downloads` discovers the selected browser's configured download folder and
checks it together with Desktop, Downloads, and requested task/destination folders.
See [browser download ownership](../../../../lib/browser/docs/README.md#credential-backed-tasks)
for the shared discovery and native collection contract.

`move_path` takes an exact destination and never merges or overwrites it.
Exclusive directory creation and file links reserve destinations, including
when calls race on a case-insensitive volume. Cross-volume files use exclusive
copies checked against the source before unlinking it. Symlinks and special
files are rejected during preflight. Folder moves can finish partially after
an error or Stop; their results identify both paths, and retries must inspect
them first. Source directories are removed only while empty, so newly added
files are preserved. A filesystem move is not evidence of an upload.

## Past chats

A session's context carries each saved chat as its card. `read_chat`
(`readChat.ts`) opens one whole and read-only, by the path the card came
under, in both hosts; see
[ChatContext admission](../../../../_shared-ts/models/Chat/ChatContext/docs/README.md).

The web host also supplies `find_chats` and live `read_chat` access through `liveChats.ts`.
See [reading another open conversation](../../../../service/handler/chat/docs/README.md#reading-another-open-conversation)
for discovery, freshness, and attribution rules.

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

- A Stop reaches the command: `runToolCommand` runs it on a scope carrying the call's abort signal.
  [2026-09-23 — Stop reaches the command](../../../../_shared-ts/models/Chat/docs/2026-09-23-stop-reaches-the-command.md)

- Test the premise before the response, and weigh saved chats as past output:
  [2026-09-10 — past chats are not evidence](2026-09-10-past-chats-are-not-evidence.md)
