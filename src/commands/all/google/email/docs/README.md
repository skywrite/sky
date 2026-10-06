---
created: 2026-08-30
updated: 2026-10-05
---

# google:email

Gmail over the OAuth grant from `google:auth` (scope `gmail.modify`).
These commands read, label, and save drafts. They do not send mail.
Gmail is draft-only across Sky, including workstream reports. All Google request
methods reject Gmail send endpoints, with no separately authorized send bypass.
Existing Gmail drafts still wait for the user to send them from Gmail.

- `google:email:inbox:view` — threads in a label as data (threadId,
  account, sender, subject, date, snippet) plus the CLI table. An
  ai:chat/voice tool. It lists every connected mailbox unless `--account`
  names one, newest first, with `--limit` applied to each mailbox.
  Viewing any label is read-only, including user labels. `totals`
  gives label-wide message/thread counts independently of the listing
  limit, added up over the mailboxes listed; `null` means a total could
  not be retrieved. `accounts` breaks the listing down by mailbox.
- `google:email:search` — Gmail queries across connected mailboxes, including
  archived and sent mail. Results carry thread IDs and accounts for reading;
  per-account errors and `hasMore` prevent a limited search claiming completeness.
- `google:email:read` — one thread with decoded bodies, oldest first,
  under 4,000-character per-message and 24,000-character per-thread caps.
  The budget goes to recent messages first. `totalMessages`,
  `omittedMessages`, and thread/per-message `truncated` flags identify
  incomplete reads. `omittedMessageIds` names skipped messages; `message` selects
  one for a 24,000-character read, and `offset=nextOffset` continues its body
  without losing text at a character boundary. These API continuations keep
  thread analysis in ordinary chat without a browser sign-in or checklist.
  The `attachments` inventory covers the entire requested thread or selected
  message independently of body limits, including nested and inline files.
  Entries carry `messageId`, `partId`, original filename, MIME type and byte
  size; encoded bytes and large provider attachment IDs stay out of chat.
  An ai:chat/voice tool.
- `google:email:attachments:download` — downloads the requested thread's
  attachments, optionally restricted by `message` and `part`. Resolves the same
  mailbox as read and verifies each selected part belongs to it. `directory`
  is required: reuse the task's destination from the conversation or plan,
  including its agreed subfolder layout. There is no fallback to daily notebook
  storage; `read_file` manages its own conversation copies. Returns verified paths, sizes and SHA-256 values for
  `read_file` to inspect. Email filenames are sanitized, identical bytes reuse
  an existing copy, and conflicting names receive numbered suffixes. Original
  filenames are retained as provider-supplied metadata, not new content IDs.
  Partial failures and Stop retain successful paths plus errors for unsaved
  parts through the chat tool boundary. Downloads neither modify mail nor
  claim the files were inspected or uploaded elsewhere.
- `google:email:draft:new` / `google:email:draft:reply` — drafts that
  wait in Gmail for the user to send by hand. Approval-gated tools.
  Creation returns `draftId` for `google:email:draft:update`.
- The inbox fetch/follow family — see the command help.

Read/view timestamps use nbdt `Instant` at the Gmail boundary and retain
UTC seconds and milliseconds.

Gmail may return attachment bytes in the message payload or behind an
attachment endpoint; the shared decoder handles both and checks the declared
size before saving. See Google's [message part body contract](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages.attachments).
Inline files remain visible in chat; the capture/follow pipeline applies its
existing signature-image filter separately. Shared Drive links are separate
documents read with `google:read`.

With several accounts connected, the chat tools work out the mailbox
instead of asking: a thread or draft is opened in the mailbox that holds
it, a listing covers every mailbox, and a new draft is written from the
work account. Each result names its `account`. The rules and their
reasons live with the shared plumbing, in
[the Google docs](../../docs/2026-10-01-the-account-is-looked-up-not-asked.md).
The inbox fetch and follow family still resolve one account strictly:
an account picker in a top-level console call, an ambiguity error from
service and composed calls.

Capture/follow operations still synchronize user labels across replies
by default. System labels are never synchronized by the listing helper.

`Sky/Follow` is the active watch; `Sky/Archived` means earlier correspondence
is saved and the watch has closed. Expiry, manual closure, and captures born
expired swap the labels before archiving the follow record. Threads without
saved history get no archive marker. Custom buckets use `<bucket>/Archived`;
a bucket ending in `/Follow` uses its sibling `/Archived`.

Saved-message detection reads both active and archived records, keyed by
account and thread id. Applying `Sky/Follow` or `Sky/Follow/Now` to an archived
thread resumes its original record and captures only new messages. `resumedAt`
starts a fresh inactivity window without changing `lastActivity`, the capture
cutoff. Resumed replies stay in the inbox. An incoming reply alone does not
reopen a watch; the archive marker does not claim that new reply is saved.

`google:email:inbox:follow:backfill` previews missing archive markers for an
account; `--apply` adds them. It skips active and queued threads and never
changes inbox placement, read status, or notebook content. It can be repeated.

A capture's day entry goes under its account's side of the day: the
Professional or Personal choice on the Google settings page, kept in
`config.jsonc` as `google.accountCategories`. An account with no choice
files as Professional.

Dated narratives:

- [2026-09-26 — a follow reads its last activity in its day's zone](2026-09-26-follow-reads-its-days-zone.md)
- [2026-09-23 — mail files under its account's side of the day](2026-09-23-mail-files-under-its-accounts-side.md)
- [2026-09-07 — Gmail stays draft-only](2026-09-07-draft-only.md)
- [2026-09-06 — complete context and read-only listings](2026-09-06-read-limits-and-labels.md)
- [2026-08-30 — reading threads and drafting replies](2026-08-30-read-and-reply-drafts.md)
