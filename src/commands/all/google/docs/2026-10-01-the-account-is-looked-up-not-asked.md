---
created: 2026-10-01
updated: 2026-10-01
---

# The account is looked up, not asked

## The problem

With one connected Google account every command just used it.
With two, every chat tool failed on its first call:
"Multiple Google accounts are authorized — pass --account".

Three things combined to cause it.

- The chat prompt told the model to leave `account` out unless the person named one.
- Every command refused to run without an account once two were stored.
- The model was never told which accounts exist.

So the first call always failed, and the retry was the model's guess from the error text.
The page showed a red failed chip each time.
The model narrated the error in its reply.
A draft cost two approvals: the card said "Account: (default)", the person approved, the run failed on the account, and the retry asked again.
An inbox question read one mailbox and passed for the whole inbox.

## What was rejected

- **Have the model pick, and keep failing when it does not.**
  It is the same guess minus one failed call.
  For a pasted link the guess can still be wrong, and the model has no way to know.
- **A "default account" setting.**
  The Professional / Personal choice on the Google settings page already says which account is work.
  A second setting would be a second place to keep the same fact.
- **Looking up which account already writes to the recipient.**
  It needs a mail search per account before every draft.
  "Work, unless the chat is personal" decides the same cases with no call at all.

## The rules

The account is almost never a choice. Which rule applies depends on what the call is about.

**Something that already exists** has an owner: a pasted Doc, Sheet or Slides link, a thread, a waiting draft.
`findOwningGoogleClient` (`lib/resolveClient.ts`) tries each account until one can open it.
The order is the named account, then the work account, then the rest.
Drive and Gmail both answer 404 for "not in this account", so a 404 moves on to the next one.
Any other failure is remembered and the search continues.
An account with a revoked grant must not hide the one that holds the thing.
Nothing is ever asked, and a wrong first try costs one call.
Used by `google:read`, `google:agent --file`, `google:email:read`, `google:email:draft:reply` and `google:email:draft:update`.

**Looking across mail** covers every account.
`google:email:inbox:view` lists each mailbox that holds the Gmail scope and merges the threads newest first.
Each thread carries its `account`, so a read or a reply that follows goes straight to the right mailbox.
`totals` adds the label counts up, and is unknown as soon as one mailbox's count is.
`accounts` breaks the listing down by mailbox.
A mailbox that cannot be read is listed with its `error` and never fails the others.
A mailbox without the label holds nothing under it (`labelMissing`).
`--limit` applies to each mailbox, so a busy one cannot push a quiet one out of the listing.

**Something new** is the only real choice: a new draft, a new document.
`resolveGoogleClientForNew` uses the work account, which is the only account marked Professional on the settings page.
The chat model passes the personal account when the chat is clearly personal.
With several work accounts nothing in code can choose.
The model picks by the organization the chat is about, and a call that names none fails with the candidates.

## Telling the model

The system prompt gets a Google Accounts section when two or more accounts are connected (`commands/lib/chat/googleAccounts.ts`).
It lists each account with its side and its organization:

```
- jane@atlas.example - work (Atlas)
- jane@example.com - personal
```

The organization is the one whose website shares the account's email domain (`accountOrg` in `#lib/google/accounts.ts`).
It reads an organization's `site` and `sites` as one list.
Only a home page counts.
A LinkedIn company page sits on LinkedIn's domain and says nothing about who owns that domain.
A domain two organizations claim names neither.

With one account there is no section and nothing to choose.

## No go is spent on a call that cannot run

An approval comes before the run, and the account used to be resolved inside the run.
That is how a draft cost two approvals.

- The cards now show the account the run will use.
  `google:email:draft:new`, `draft:reply`, `draft:update` and `google:agent` resolve it the way the run does.
- A call whose account cannot be resolved needs no go (`needsApprovalFor`).
  The run stops at that question before anything is written, so it runs at once and fails with the reason.
  Only an `AccountResolutionError` exempts a call. Any other failure still asks.

## Saying which account

- Every result carries `account`.
  A result carries `accountNote` when another account was tried first and could not open the thing.
- On the web, a Google tool's run carries the account its result reports (`runAccount` in `service/handler/chat/toolRuns.ts`).
  The chip and the folded row show it right after the tool's name, and never cut it short.
  A listing over several mailboxes says how many.
  It is a field of its own because a finished run folds to its summary line and drops the call's subject.
- The prompt tells the model to name the account in its reply, and why when it chose it.

## What it does not change

- `resolveGoogleClient` and `resolveGmailClient` still fail on an open choice, and still ask in a top-level terminal run.
  `google:find`, the inbox fetch and follow family, and voice's `search_email` keep that behavior.
- Calendar scheduling has its own account question and picker.
- The cards show the account. They have no control to switch it: declining and naming the account is how it changes.
