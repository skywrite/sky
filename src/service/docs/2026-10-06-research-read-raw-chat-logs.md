---
created: 2026-10-06
updated: 2026-10-06
---

# The research agent read raw chat files, logs and all

## What was wrong

A saved chat ends with its context log in an HTML comment. Over a recent
month of chats the comments weighed sixteen times the conversations: nine
tenths of every chat file is machine JSON. The chat's own pipeline strips
comments on both of its ingestion paths, so its token counts and prompts
carry conversation only (checked against the files: logged tokens equal the
stripped size at every percentile).

The research agent's `notebook_query` and `notebook_read` tools read matching
files straight from disk and paged the raw text. A matched chat counted at its
raw size against the 30k-token result cap, so one chat could fill the cap
alone and cut the other matches; the agent's "read more" offsets led into the
log JSON; and the lexical ranking measured term density over text that was
mostly log. The chat never saw this, because the two paths had different
rules. Seven call sites each remembered to strip; one did not.

## What was rejected

- **A one-line strip call in the research tool.** It fixes the symptom and
  leaves two readers with their own rules, which is the cause.
- **Keeping byte offsets into the original file.** The tool's comment called
  them a requirement ("not a store's reserialization"), but the model never
  saw the file. It needs stable positions in the text it reads, and one
  server-side transformation can promise that where two disk readers cannot.

## Why the fix works

One definition of "this document as a model reads it" lives in
`#shared/models/AI/DocumentPages`: comments removed, pages of at most 24k
characters, `find` opening shortly before the hit, a `version` digest of the
whole text. The service serves it at `POST /context/document`; research pages
through the client and no longer opens files for content. Offsets are
positions in the served text, so they are the same for every client and
every request while the version holds. When the service is down the pages are
errors, never a disk read, so the second path cannot grow back.

The chat's query-result path still parses files locally with the same strip
call; moving it onto the endpoint is the next step, and a banned-API lint
follows once two clients exist. Taking the log out of the chat file into a
sidecar removes the hazard class entirely and is its own decision.
