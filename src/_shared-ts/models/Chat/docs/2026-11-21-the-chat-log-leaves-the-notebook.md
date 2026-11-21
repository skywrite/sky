---
created: 2026-11-21
updated: 2026-11-21
---

# The chat log leaves the notebook

## What was wrong

A saved chat ended with its machine record: a trailing `<!-- CONTEXT-LOG ... -->` comment holding the per-turn context
log, the statistics, and the session's recovery state.
That record grew with every feature that needed to survive a restart.
Since September it has carried the model's full history, tool results and attached files included.

Measured over four weeks of saved chats, the record was 99% of the bytes.
Single chat files reached tens of megabytes, for a conversation of a few thousand words.

The notebook is the person's own, a diffable repository at human scale.
A file there that is almost entirely machine data is the same mistake as a machine key in frontmatter,
at a thousand times the size.
Every reader of a chat had to remember to strip the comment, and every getter on `ChatDocument` parsed it again.

## What changed

A saved chat is two files.

- **The transcript**, in the notebook: frontmatter, title, summary and conversation. Nothing follows the conversation.
- **The log**, under Sky's state: the same JSON the comment held, in a file at the transcript's own notebook-relative
  path. `time/2026/W05/01-27/actions/ai-chats/09-30_Atlas.md` keeps its log at
  `<state>/ai/chats/logs/time/2026/W05/01-27/actions/ai-chats/09-30_Atlas.json`.

`ChatStore/logFile.ts` owns the pairing: `chatLogPath`, `readChatLog`, `writeChatLog`.
`saveChat` writes the log file, then the transcript.
`loadResumeSession`, the memory usage scan and the saved reply threads' statistics read through `readChatLog`.

Hosts pass the log folder in, as they pass the snapshot folder.
Both hosts derive it from the snapshot folder (`chatLogDirOf`), so a host that points its snapshots at a temp folder,
as every test does, cannot write logs into real state.

Crash snapshots are unchanged.
A snapshot is state already, and one file that holds the whole thread is what crash insurance wants.

## Reading chats saved before

A transcript that carries its own log is read from it, exactly as before.
That log wins over a log file at the same key: it is by construction the one that matches the text above it.

Such a chat moves to the two-file shape the next time it is saved.
`sky ai:chat:migrate --execute` moves the rest in one pass (`moveChatLogOut`).
The move copies the comment's JSON as written, so a key this version does not know survives it.
It rewrites the transcript only after the log file reads back, and only when what remains is the transcript's own
text up to the comment and reads as the same chat.
A transcript with a log of another version, with two logs, or with a different log file already at its key is left
as it was and listed with the reason.

## What was rejected

- **An id in the frontmatter, keying the log.**
  A machine id in a person's document is what this change removes.
  Sky never renames a saved chat, so its path is already its identity.
- **Keeping the comment as an option of the save.**
  A mode nobody uses in production is a mode only tests exercise.
  The one case that still writes the comment is a resumed transcript outside the notebook root,
  which has nowhere to key a log file, and it is covered by a test.
- **A separate config key for the log folder.**
  A test that overrides the snapshot folder and forgets a second key would write into real state.
  Deriving one from the other removes the second thing to forget.
- **Splitting the light part of the log from the model history.**
  The usage scan and the statistics read a few fields and parse the whole file to get them.
  A split would speed that up and make every save two log writes that must agree. Not needed yet.
- **Sweeping log files whose transcript is gone.**
  A notebook that is not mounted looks exactly like a notebook whose chats were all deleted.
  An automatic sweep would then delete every log. Orphans cost disk and nothing else.

## What it leaves

- A transcript moved or renamed by hand leaves its log behind.
  It opens as its conversation alone and gathers context afresh when continued.
- Deleting a chat in the notebook leaves its log file in state.
- The log is as large as it was. It is out of the notebook, not smaller.

## Order of the two writes

The log goes first.
A save that fails after it leaves the transcript as it was, the snapshot in place, and a retry clean.
The other order would leave a transcript with new turns and no record of them.

If the process dies between the two writes of a resumed chat, the log is one save ahead of the transcript.
Its session carries the key of the newer conversation, so the loader does not restore that model history,
and the extra entries describe a turn the transcript does not hold. The next save writes both again.

## Verified

- Unit: `logFile_test.ts` (the key, read and write, the transcript's own log winning, every refusal of the move),
  `save_test.ts` (a new chat's transcript holds no comment, a chat saved the earlier way moves its log out on the
  next save, a refused write-back writes no log file, a transcript outside the notebook keeps its log),
  `mod_test.ts` (loading from the log file, loading without the log folder, a branch joining its parent's log file).
