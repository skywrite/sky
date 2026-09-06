---
created: 2026-08-30
updated: 2026-09-05
---

# Settings — the web's settings section

Design notes for `src/service/handler/settings/` and the pages in
`theme/client/settings.tsx`. Read this before adding a setting.

## The shape

Mainstream-shaped, ruled 2026-08-30 after the first attempt — a raw
dump of config.jsonc — was rejected. A settings section reads like a
normal app's: sections in the sidebar (the way Explorer swaps in the
file tree), plain words, no plumbing keys. The design boards live in
the "Sky Settings" canvas artifact.

Sections at `/settings` and `/settings/<section>`:

- **Appearance** — theme (System / Light / Dark) and text size. Saved
  to `web.theme` / `web.textSize`; applied on the spot, and at app
  start by `useAppearanceBoot`. The sidebar's quick toggle writes the
  same key. Text size is a page zoom.
- **Voice** — every Realtime voice with a Hear button (the audition's
  receive-only call, one row at a time), the pick saved to
  `voice.voice`. Sessions read it per call (`preferredVoice()` in
  `commands/lib/voice/sessionConfig.ts`), so a change speaks on the
  next call — CLI and web both. Microphone and speaker are the call
  bar's own browser-local choice (`sky-voice-devices`), shown here.
- **AI** — the model roles (registry `ROLES`, read-only, each naming
  its configuration), every model configuration — the built-in
  `default-*` catalog and yours — and the ai/memory note count. Yours
  are defined right here: name, provider, model, optional baseUrl and
  options (JSON), written to `ai.profiles.<name>`, which the registry
  already consumes (`getAllProfiles`; config wins on a name clash —
  shown as "overrides the built-in"). Deleting prunes any `ai`/
  `profiles` shells the removal empties, so the file stays as
  `sky init` wrote it. Names: `PROFILE_NAME` (no spaces). Still to
  come: pointing a role — or a single chat — at a configuration; the
  registry's `AI_PROFILES` is read at process start, so the service's
  own calls see a new profile after a restart, while every CLI run
  sees it at once.
- **Connections** — the keychain's page (`connections.ts`, its host in
  `createConnectionsHost.ts`, the pane in `theme/client/settingsConnections.tsx`).
  Two cards. Accounts: Slack as agent-slack reports it (its test, and a
  Brave re-import when the test fails — `sky slack:auth`'s two moves,
  shared through `commands/all/slack/lib/authStatus.ts`); every Google
  account with what its grant covers (Mail, Calendar, Drive, Docs — read
  off the token's scopes); and the Google Cloud client Sky signs in as. A
  sign-in runs `sky google:auth`'s loopback flow inside the service: the
  consent page opens in a browser tab, the redirect lands on 127.0.0.1 on
  the machine the service runs on, and the page asks after the sign-in by
  id until it is done. Keychain: every other entry, complete — the
  `secrets:list`, `secrets:set` and `secrets:delete` of the terminal over
  the same store. A row reads in plain words: a key stored under a
  provider's name is "<Provider> API key"; a login shows its username; a
  key long enough shows its last four characters, so two keys can be
  told apart. The store's filler name for a category's single entry
  (`KEY_ENTRY_NAME`) is filled in for a blank name and never printed.
  Change and Remove on each row (every remove asks twice), and a form to
  add one as a key/token or a login. Presence only: a value never comes
  back out whole.
- **Notebook** — where things live (with Show in Finder), the editor
  (detected commands, saved to `editor`), export and drop folders.
- **Advanced** — the configuration view kept from the first rung:
  every key, its value, and its provenance (file / default /
  `env · SKY_DIR`). `ENV_OVERRIDES` is shared with the loader so the
  two cannot drift. Plus "Open config file".
- **About** — the build (git, cached per process) and the service.

Connections was deferred by ruling on 2026-08-31 and built on
2026-09-03 — see `2026-09-03-connections.md`.

## How writes work

`POST /settings/_api/set { key, value }` — only keys in
`SETTABLE_KEYS`, each validated (themes, sizes, the host's voices,
detected editors). Writes go through `setConfigValue`
(`_shared-ts/config/write.ts`): jsonc-parser edits the text, so the
comments `sky init` wrote survive; the write is atomic. The client
applies changes optimistically and falls back to a reload on refusal.

The service process keeps its boot-time `#config`; everything the page
serves is read fresh per request (`load()`), and the voice is resolved
per session, so no restart is needed for any settable key.

### Writes into the keychain

Under `/settings/_api/connections/`: `POST secret { category, name,
type: 'secret', value }` or `{ …, type: 'login', user, pass }` stores one
entry (a same-type write keeps the entry's `created`; a change of type
starts fresh); `DELETE secret/:category/:name` removes one and 404s an
unknown name; `POST google/client { clientId, clientSecret }` stores the
OAuth client pair; `POST google/connect` starts a sign-in and answers
`{ id, url }` (409 without a client); `GET google/connect/:id` answers
`waiting`, `done` with the email, or `failed` with the reason. Names are
`SECRET_CATEGORY` / `SECRET_NAME` — letters, digits, dots, dashes, underscores, and
for names `@` and `+`, since an account email is a name; a blank name
becomes the filler. Values are never read back whole: `GET connections`
answers the index plus, for a login, its username, and for a long key,
its last four characters.

The form and write route share the pure rules in `secretValidation.ts`.
Each edited or blurred field validates locally: its outline and message
update as the person types, without a request or moving focus. Untouched
fields start quiet; a blank optional name is valid. Save is disabled until
the visible fields are valid. Changing between a key and a login checks
only the fields that apply to that kind.

The route also validates and returns `{ field, message }` with status 400.
For a server rejection, the form highlights and focuses that input and
places the message directly below it. Connection and keychain failures
remain form-level alerts. The browser never infers a field from an error's
wording; all entered values remain available to correct and retry.

## The host seam

`createSettingsRoutes(host)` — the host (`SettingsHost`) is the
machine: config snapshot, voices, model rows, editor detection, memory
count, git build, write, reveal (`open`, macOS), and `connections` — a
`ConnectionsHost`: the keychain (`SecretsProvider`), the environment,
the keyed providers, Google's sign-in, agent-slack. Tests script every
part; nothing in the route tests touches the real machine or the real
keychain — the connections tests run over `TestSecretsProvider`.

## Where each kind of setting lives (ruled 2026-08-30)

| Kind | Home |
| --- | --- |
| Preferences and app wiring | `~/.sky/config.jsonc` — readable, shareable |
| Account credentials | the keychain, through `context.secrets` — the Connections page |
| Provider API keys | the keychain, under the provider's name (Cerebras reads its entry); `src/.env` is still what OpenAI and Anthropic read, and the page does not show those — keychain-first for them is the open rung |

The config file stays free of secrets. This page never shows a key or
a credential; Connections shows presence, never values.
