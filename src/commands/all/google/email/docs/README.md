---
created: 2026-08-30
updated: 2026-09-26
---

# google:email

Gmail over the OAuth grant from `google:auth` (scope `gmail.modify`).
These commands read, label, and save drafts. They do not send mail.
Gmail is draft-only across Sky, including workstream reports. All Google request
methods reject Gmail send endpoints, with no separately authorized send bypass.
Existing Gmail drafts still wait for the user to send them from Gmail.

- `google:email:inbox:view` — threads in a label as data (threadId,
  sender, subject, date, snippet) plus the CLI table. An ai:chat/voice
  tool. Viewing any label is read-only, including user labels. `totals`
  gives label-wide message/thread counts independently of the listing
  limit; `null` means those totals could not be retrieved.
- `google:email:read` — one thread with decoded bodies, oldest first,
  under 4,000-character per-message and 24,000-character per-thread caps.
  The budget goes to recent messages first. `totalMessages`,
  `omittedMessages`, and thread/per-message `truncated` flags identify
  incomplete reads. An ai:chat/voice tool.
- `google:email:draft:new` / `google:email:draft:reply` — drafts that
  wait in Gmail for the user to send by hand. Approval-gated tools.
  Creation returns `draftId` for `google:email:draft:update`.
- The inbox fetch/follow family — see the command help.

Read/view timestamps use nbdt `Instant` at the Gmail boundary and retain
UTC seconds and milliseconds. Account pickers are limited to a top-level
console call; service and composed calls return account ambiguity errors.

Capture/follow operations still synchronize user labels across replies
by default. System labels are never synchronized by the listing helper.

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
