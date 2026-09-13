---
created: 2026-08-30
updated: 2026-09-13
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

Settings use one level of navigation: Appearance; Me (About me, Writing style);
AI (Models, Voice, Prompts); Connections; Notebook; Advanced; About Sky.
Group labels open their first page; the adjacent disclosure toggles their children.
`theme/client/settingsRoutes.ts` owns canonical paths and legacy aliases, including
prompt detail paths. Existing `/settings/ai`, `/settings/voice`,
`/settings/writing-voice`, and `/settings/prompts/...` links keep working.

Pages:

- **Appearance** — theme (System / Light / Dark) and text size. Saved
  to `web.theme` / `web.textSize`; applied on the spot, and at app
  start by `useAppearanceBoot`. The sidebar's quick toggle writes the
  same key. Text size is a page zoom.
- **Me → About me** — `/settings/me`: a name, freeform profile, and optional
  website/profile links. Saves use the existing `journal/about-me.md`, preserving
  frontmatter and legacy sections; `name` and `sites` live in frontmatter. No
  separate profile store: voice, Outbox, prompt templates, and new text chat
  sessions consume this same document. Freeform profiles remain readable through
  `AboutMeDocument.bio`. Revision checks prevent stale editor saves. Drafts survive
  app navigation and warn before leaving the tab.
  Learn about me reads only the supplied public links and proposes an editable
  profile with source links. Each redirect is resolved and pinned to public IPs;
  reads are bounded. Web text is evidence, never instructions. Failed sources
  remain visible, and accepting a suggestion changes the draft until Save.
  The existing memory count and notebook link live here too.
- **AI → Voice** — independent Sky and Sonny voice pickers, each with a Hear
  button (the audition's receive-only call, one row at a time). Picks
  save to `voice.voice` and `voice.researcherVoice`, resolved per session
  in `commands/lib/voice/sessionConfig.ts`, so changes apply to the next
  call. See the owning
  [voice design](../../../../commands/lib/voice/docs/README.md).
  Microphone and speaker are the call bar's own browser-local choice
  (`sky-voice-devices`), shown here.
- **Me → Writing style** — `/settings/me/writing-style`: model configuration picker, shared writing rules, draft
  practice, revision questions, and example compaction. Storage and learning
  belong to [writing voice](../../../../lib/writingVoice/docs/README.md).
  The selection saves to `ai.writingVoiceProfile` and applies on the next call.
- **AI → Models** — `/settings/ai/models`: Thinking, Quick, Balanced, and
  Vision select named presets (`ai.roles`). Each preset owns a model and
  default effort; the inline effort control edits that preset, and shared
  roles are identified beside it. Preset editors separate model and effort,
  with provider ID, server, context window, and other JSON options under
  Advanced. Edits write `ai.profiles.<name>`; built-ins can be overridden
  and restored. Assigned custom presets cannot be deleted until their roles
  are reassigned. The registry resolves the current config for every call,
  without a service restart. Chat and CLI effort overrides do not mutate
  presets. See the [registry contract](../../../../_shared-ts/ai/docs/README.md).
- **AI → Prompts** — `/settings/ai/prompts`: a searchable list of real prompt files and
  their source references. Visual/Markdown editing, saved template links, sample
  variables, and a live rendered preview share one page. Saves create notebook
  customizations used by the runtime loader. New prompt and Restore built-in are
  available. See the [prompt library design](../../../../_shared-ts/prompts/docs/README.md)
  for storage, references, conflict handling, and runtime behavior.
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

Keychain timeouts, background access, and the explicit Restore access action
follow the [shared Keychain contract](../../../../lib/secrets/docs/README.md).

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
