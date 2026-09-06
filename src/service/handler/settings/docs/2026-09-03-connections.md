---
created: 2026-09-03
updated: 2026-09-03
---

# Connections: the keychain gets a page

Sky keeps its credentials in the OS keychain: Google tokens, the OAuth
client, a Cerebras key, the tokens and passwords commands ask for. Until
today the only way to see or change them was the terminal — `sky
secrets:list`, `secrets:set`, `secrets:delete`, `google:auth`,
`slack:auth`. The settings section built on 2026-08-30 left its
Connections pane out by ruling ("leave keychain and env out
temporarily"). Today's ask was to connect it.

## What was built

- `settings/connections.ts` — the routes and the shape of what the page
  is told. `describeConnections` reads the keychain's index and answers
  presence: the Google client and accounts (each account's grants read
  off its token's scopes), each keyed provider's key by where it is, and
  every other entry by name and type. A login carries its username so
  two can be told apart. No value crosses; a test asserts the whole
  answer contains none of the seeded values.
- `settings/createConnectionsHost.ts` — the real machine: the keychain
  through `KeychainSecretsProvider`, the process environment, the
  keyed providers with what each is used for (the model roles pointing
  at it, plus voice and transcription for OpenAI), Google's sign-in and
  agent-slack.
- The Google sign-in runs inside the service the way `sky google:auth`
  runs it in the terminal: a loopback receiver on 127.0.0.1, the consent
  URL handed to the page, which opens it in a tab; the code exchanged
  and the account's tokens stored when Google redirects back. The page
  asks after the sign-in by id every second and a half until it is done
  or failed. The browser has to be on the machine the service runs on —
  the redirect lands on its loopback.
- Slack stays agent-slack's. `sky slack:auth`'s two moves — the test,
  the Brave re-import — moved into `commands/all/slack/lib/authStatus.ts`
  so the command and the page share them.
- The one-time Google Cloud steps moved from the `google:auth` walkthrough
  into `lib/google/setup.ts`; the CLI prints them, the page shows them
  beside the client form, so they cannot drift.
- `theme/client/settingsConnections.tsx` — the pane. The settings pages'
  building blocks moved to `settingsBlocks.tsx` so the two panes share
  them.

## The first cut, and the same evening's correction

The first cut had three cards: Accounts, API keys, Other secrets. API keys
had a row per provider — Anthropic and OpenAI marked Set from `src/.env`,
Cerebras marked Set from the keychain — and Other secrets listed what was
left. Opening the page, the one key actually in the keychain was not in
the keychain list; it sat in a card about keys that mostly were not in the
keychain, shown as the word Set and nothing else. That was the wrong
shape, and it was called so at once.

The page now has two cards. Accounts is unchanged. Keychain is the whole
store but the Google entries, complete, and each row reads in plain words:
a key stored under a provider's name is "Cerebras API key"; a login shows
its username; a key long enough shows its last four characters
(`tailOf`), the way every key dashboard does, so two keys can be told
apart — a short secret shows none, and a tail is shown only when the
index and the entry agree the value is a key, never for a password. The
store is category and name, and a category's single entry — a provider's
key — has nothing to name, so the terminal fills the slot with a word.
That word is filled in for a blank name on the form ("Which one" is
optional) and never printed on the page.

Anthropic and OpenAI still read their keys from `src/.env`, and the page
does not show them: showing a key the keychain does not hold, in a card
about the keychain, is what misled. Switching those two providers to the
keychain — and which wins when both places hold a key — is the rung the
2026-08-30 session left open. Nothing here decides it; when it lands, the
providers' keys appear in the Keychain card like any other entry.

## Verified

- Route tests over an in-memory store (`connections_test.ts`): the
  payload's rows — a provider key by its label and tail, a login by its
  username, a short secret without a tail — and grants, the values
  canary, set (a blank name filled, trim, a same-type write keeps
  `created`, a type change starts fresh, five refusals), delete (a
  secret, a Google account by encoded email, a 404), the Google client
  and sign-in (400, 200, 200 with id and URL, 404, 409), Slack
  pass-through. One test in `settingsRoute_test.ts` shows the
  routes riding under `/settings/_api/connections` only when the host
  carries a keychain.
