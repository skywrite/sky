---
created: 2026-09-01
updated: 2026-10-11
---

# google — Workspace commands

The group's root commands, and where the depth lives:

- `google:auth` connects accounts (tokens stay in the keychain via `context.secrets`).
- `google:find` searches Drive by name or content.
- `google:read` reads one page of a Doc (markdown), Sheet (csv, first tab) or
  Slides (text) by URL or file id — paged at 40k chars, tab-aware, and exposed
  to ai:chat as the auto-approved `google_read` tool. Uploaded Office files are
  read through their native Google twin (converted once, reused).
- `google:agent` is the write side: a sub-agent that creates and edits Docs,
  Sheets and Slides from a mission. Its docs live in
  [`agent/docs/`](../agent/docs/README.md).
- `google:browser` sets up the local browser session the agent drives for
  anchored comments and suggested edits.
- `google:email:*` (Gmail) and `google:calendar:*` have their own trees;
  Gmail's docs live in [`email/docs/`](../email/docs/README.md).
- The web [meeting composer](../../../../service/handler/meetings/docs/README.md)
  uses `#lib/google/createCalendarMeeting.ts` to create a reviewed Zoom invitation
  through the existing Calendar add-on and shared Google browser session.
- [CalendarScheduler](../../../../lib/calendarScheduler/docs/README.md) also edits
  and reschedules existing events through `calendar:update`, using shared provider
  reads and `#lib/google/updateCalendarEvent.ts` for the browser update.

Shared plumbing sits in `lib/` (account resolution, the shared read path)
on top of the API client in `#lib/google`.

## Document snapshots

`google:read` and the Google Agent's reads and outlines share
`#lib/google/docSnapshots.ts`. A document first read by Sky gets a rebuildable
sidecar at `<state>/google/docs/<account-hash>/<file-id-hash>/snapshot.json`.
The account and provider ID are hashed to preserve their identity on
case-insensitive filesystems. One atomic file holds the structured Docs response,
Drive metadata, capture time, and the markdown export when one has been requested.
Tab text and outlines come from that same structure; an outline or tab read does
not trigger a markdown export.

Every read checks current Drive metadata before reusing the sidecar. A matching
`version` and unchanged edit/comment capabilities permit reuse; missing access
never falls back to cached content. Captures and lazy exports check the version
and capabilities before and after fetching, retrying at most three times if the
document changes. Docs pagination carries that version and rejects a continuation
from a different version. Malformed cache files are rebuilt; cache storage failure
does not prevent a live read.

Drive versions are persistent freshness markers. Docs revision IDs are separate,
account-specific write tokens, guaranteed by Google for only 24 hours. Before an
edit, a token older than 23 hours is renewed with a small Docs request and another
Drive check. A changed access level refreshes the structure: positions from a
read-only suggestions preview cannot be paired with an inline editing revision.
The agent records the revision of the content it actually read and passes it as
`requiredRevisionId` on batch edits. A conflict requires a new read and a newly
prepared edit; deterministic restyling advances the required revision after every
successful batch. See Google's [revision contract](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents)
and [write controls](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/batchUpdate#WriteControl).

## Which account a command uses

With several accounts connected, a command works out the account instead
of asking (`lib/resolveClient.ts`):

- Something that already exists — a file, a thread, a draft — is opened by
  whichever account holds it (`findOwningGoogleClient`).
- A mail listing covers every account, each thread marked with its own.
- Something new comes from the work account, the one marked Professional
  on the Google settings page (`resolveGoogleClientForNew`).

`--account` names one outright. Every result says which `account` was used.
`resolveGoogleClient` is the strict form the rest still use: it fails on an
open choice, or asks in a top-level terminal run.

## Narratives

- [2026-10-01 — the account is looked up, not asked](2026-10-01-the-account-is-looked-up-not-asked.md)
- [2026-09-01 — google:read becomes the chat's read path](2026-09-01-google-read-chat-tool.md)
