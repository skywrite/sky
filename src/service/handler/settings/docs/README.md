---
created: 2026-08-30
updated: 2026-10-24
---

# Settings — the web's settings section

Design notes for `src/service/handler/settings/` and the pages in
`web/client/settings/settings.tsx`. Read this before adding a setting.

## The shape

Mainstream-shaped, ruled 2026-08-30 after the first attempt — a raw
dump of config.jsonc — was rejected. A settings section reads like a
normal app's: sections in the sidebar (the way Explorer swaps in the
file tree), plain words, no plumbing keys. The design boards live in
the "Sky Settings" canvas artifact.

People & Orgs appears above the Settings heading in this sidebar. Its pages and
record storage are owned by [People & Orgs](../../people/docs/README.md).

Settings use one level of navigation: Appearance; Me (About me, Writing style);
AI (Models, Audio transcription, Voice, Prompts); Connections; Browser automation;
Extensions; Notebook; Advanced; Experimental; About Sky.
Group labels open their first page; the adjacent disclosure toggles their children.
`web/client/settings/settingsRoutes.ts` owns canonical paths and legacy aliases, including
prompt detail paths. Existing `/settings/ai`, `/settings/voice`,
`/settings/writing-voice`, and `/settings/prompts/...` links keep working.

Pages:

- **Appearance** — theme (System / Light / Dark) and text size. Saved
  to `web.theme` / `web.textSize`; applied on the spot, and at app
  start by `useSettingsBoot`. The sidebar's quick toggle writes the
  same key. Text size is a page zoom.
- **Me → About me** — `/settings/me`: a name, freeform profile, and optional
  website/profile links. Saves use the existing `me/about.md`, preserving
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
- **AI → Audio transcription** — `/settings/ai/transcription`: provider, model,
  upload limit, and API key availability. Selecting MacWhisper loads its
  installed local models, with refresh and setup guidance. Saves to `ai.models.transcription`;
  the [transcript pipeline](../../../../commands/all/audio/transcript/docs/README.md)
  owns provider selection and retry behavior.
- **AI → Voice** — Sky's voice picker with a Hear button using the shared
  GPT-Live preview. Picks save to `voice.voice`, resolved per session
  in `commands/lib/voice/sessionConfig.ts`, so changes apply to the next
  call. See the owning
  [voice design](../../../../commands/lib/voice/docs/README.md).
  Microphone and speaker are the call bar's own browser-local choice
  (`sky-voice-devices`), shown here.
- **Me → Writing style** — `/settings/me/writing-style`: model configuration picker, shared writing rules, draft
  practice, revision questions, and example compaction. Storage and learning
  belong to [writing voice](../../../../lib/writingVoice/docs/README.md).
  The selection saves to `ai.writingVoiceProfile` and applies on the next call.
- **AI → Models** — `/settings/ai/models`: Chat, Thinking, Quick, Balanced, and
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
- **Connections** — account integrations (`connections.ts`, its host in
  `createConnectionsHost.ts`, the pane in `web/client/settings/settingsConnections.tsx`).
  Google, Slack and Beeper retain their existing setup and account management.
  API keys stay with their integrations; the TypeSafe service row links to
  its validated key setup. Accounts that lose
  Keychain access retain their contextual Restore access action.
  Slack checks remain noninteractive and show persistent pauses. Its explicit
  Restore access action tests saved credentials before any Brave import; the
  [Slack authentication boundary](../../../../commands/all/slack/README.md#authentication-and-background-checks)
  owns this contract.
  Since 2026-09-16 the Accounts block carries a Beeper row: Connect runs
  the desktop app's own approval page and stores the grant as
  `beeper/desktop`, a token made in Beeper is accepted instead, and its
  grant stays managed by the connection. See `lib/beeper/docs/README.md`.
  Since 2026-09-22 a connected Beeper row reads which networks are saved
  and which wait, and leads to Beeper's own page.
- **Connections → Beeper** — `/settings/connections/beeper`, the first
  connection with a page of its own (`web/client/settings/settingsBeeper.tsx` in
  the shell `settingsConnectionPage.tsx`; routes under `/beeper/…` in
  `connections.ts`). A connection's page carries what Sky does with it:
  status, a card per network with three switches (save, groups, hold
  texts from unknown senders), the chats held for a look with Save and
  Open in Beeper, the last check with what it left out and why, Check now,
  and a preview of what the next check would save. The rules live beside the
  capture's state in `state/beeper/sync.json`, not in `config.jsonc`,
  because they key on Beeper's account ids. Every connection gets a page
  this way as it grows rules of its own (ruled 2026-09-22).
- **Connections → Messages on this Mac** — a row on the Connections page,
  since 2026-10-20 (`web/client/settings/settingsMacMessages.tsx`; routes
  `/mac-messages` and `/mac-messages/open-settings` in `connections.ts`, the
  host part in `createConnectionsHost.ts`, the reading in
  [`lib/macMessages`](../../../../lib/macMessages/docs/README.md)). Beeper
  shows iMessage senders by number alone, so the names come from this Mac's
  Contacts and Messages, which the service may read only with Full Disk
  Access. The row says whether it can, names the binary to add, opens the
  System Settings pane, and reads again on Check again; the iMessage card on
  Beeper's page points here while it cannot. Absent off a Mac.
- **Connections → Slack** — `/settings/connections/slack`, since 2026-10-20
  (`web/client/settings/settingsSlack.tsx`; routes under `/slack/channels`,
  `/slack/pull` and `/slack/marks` in `connections.ts`, the host's cache
  part in `createConnectionsHost.ts`). What Sky does with Slack today is the
  [channel cache](../../../../commands/all/slack/pull/docs/README.md), so the
  page carries: the workspace line (the same silent status as the row), the
  last few checks the pull made, Check now, the two marks in Slack with their
  live counts, and every joined channel with a switch. A channel switched off
  is a mute: the pull leaves it out and its cursor follows the channel, so
  switching it back on resumes from now. Mutes live in `state/slack/rules.yaml`,
  apart from the roster the pull rewrites. The connections row leads to the
  page when Slack is connected. Since 2026-10-20 the page also carries For
  you: three switches writing `slack.forYou.dms`, `.mentions` and `.own`,
  the rules the [landing pass](../../../../commands/all/slack/land/docs/README.md)
  reads on every pass. Left out this week, the last block of the 2026-10-16
  mock, still waits for something to count.
- **Connections → Google** — `/settings/connections/google`
  includes the Calendar classification switch; see the
  [classification contract](../../../../lib/calendarClassification/docs/README.md).
  (`web/client/settings/settingsGoogle.tsx`; routes under `/google/…` in
  `connections.ts`). Connect shows what the person agrees to, then Sky
  sets up the Google Cloud side itself in a window they sign in to and the
  page follows the run as a checklist (`lib/google/cloudSetup/docs/README.md`).
  A connected account shows what its grant covers, names a box left
  unticked with Connect again (the pair that already served it), and says
  which project Sky set up for it. Add another account runs the same setup
  again — every account gets its own private connection, because a pair one
  account granted to may be shut to another (a work client is often
  restricted to its organization) and the page cannot tell in advance.
  Advanced keeps the developer's path: paste a client of your own, which
  signs in at once. The Google row on the Connections page leads here since
  2026-09-22.
  Since 2026-09-23 a "Professional or personal" card gives each connected
  account the side of the day its saved mail is filed under. The choice is
  `google.accountCategories` in `config.jsonc`, keyed by lower-case email; see
  `commands/all/google/email/docs/README.md`.
- **Connections → Notion** — `/settings/connections/notion`, since 2026-10-24
  (`web/client/settings/settingsNotion.tsx`; routes under `/notion` in `connections.ts`, the host part in
  `createConnectionsHost.ts`). Connect on the Accounts row opens Notion's own approval page in a tab, and the row
  turns connected when the redirect lands; the page names the workspace and who signed in, and disconnects.
  Every visit asks Notion who is signed in, so a grant Notion stopped honoring reads as expired. The host part is
  optional: without it the routes answer 503 and the row stays hidden. Why Sky signs in through Notion's MCP
  server, and what chats do with it: [notion commands](../../../../commands/all/notion/docs/README.md).
- **Browser automation** — `/settings/browser-automation`: password manager
  setup, native approval for supported password logins, and the manual handoff
  for other authentication steps. One 1Password row groups
  accounts; Manage shows saved vaults and optional exclusions. Connect discovers
  local accounts and starts native approval without an account-entry form.
  Setup instructions appear only after a connection failure. All accessible
  vaults are included by default. Settings reads saved metadata without contacting
  providers; Refresh vaults is explicit. Apple Passwords is marked unavailable:
  storing Sky's API keys in Keychain does not supply Apple Passwords login access.
  The old `/settings/credentials` page resolves here. Provider contracts remain
  in [credential providers](../../../../lib/credentials/docs/README.md).
- **Connections → TypeSafe** — `/settings/connections/typesafe`: the existing
  validated key setup. Only an accepted key is stored as `typesafe/main`; the
  row reports Connected, Refused or Not set, and the models the key may use.
  Google setup and Connections link here; the former `/settings/credentials/typesafe`
  link remains supported. See
  `_shared-ts/ai/docs/2026-09-17-typesafe-jev.md`.
- **Connections → Anthropic, OpenAI, Cerebras** — `/settings/connections/<provider>`
  (`providerKeys.ts`, routes under `/keys/<provider>`): the model providers'
  keys, set up the way TypeSafe's is. A pasted key is checked by listing the
  provider's models and stored as `<provider>/main` only when accepted; every
  visit checks again, so the row reads Connected, Refused or Not set. A key
  still in `src/.env` reads as such until one is saved here. Where Sky reads
  these keys: [Providers and their keys](../../../../_shared-ts/ai/docs/README.md#providers-and-their-keys).
- **Extensions** — `/settings/extensions`: the installed extensions, each
  with its version, author, categories, or why it did not load, a switch,
  and Reload. An extension with a settings screen opens at
  `/settings/extensions/<author>/<slug>`. Since 2026-09-26; see
  `lib/extensions/docs/README.md`.
- **Notebook** — where things live (with Show in Finder), the editor
  (detected commands, saved to `editor`), export and drop folders.
- **Advanced** — the configuration view kept from the first rung:
  every key, its value, and its provenance (file / default /
  `env · SKY_DIR`). `ENV_OVERRIDES` is shared with the loader so the
  two cannot drift. Plus "Open config file".
- **Experimental** — `/settings/experimental`: features still taking
  shape, one switch each. Since 2026-09-17: "Jev preflight for notebook
  context" — `experimental.contextPreflight`, off by default;
  on, a web chat turn asks TypeSafe's Jev before reading the notebook and
  skips the reading when the message needs none. See the
  [chat note](../../chat/docs/2026-09-17-ask-first-whether-a-message-needs-the-notebook.md).
  "Workstreams" — `experimental.workstreams`, off by default — shows the
  Workstreams sidebar entry on desktop and mobile. A successful save updates
  navigation immediately; the saved choice is loaded again when the app opens.
  This controls navigation visibility, leaving workstream data and direct links intact.
  "Jev drives the browser" — `experimental.jevBrowser`, ON by default —
  `sky browser:task` lets Jev pick each move from a table of the page,
  with the reasoning model reading when Jev is stuck, typing, checking
  the files and writing the report; since 2026-09-25.
- **About** — the build (git, cached per process) and the service.

Connections was deferred by ruling on 2026-08-31 and built on
2026-09-03 — see `2026-09-03-connections.md`.

## How writes work

`POST /settings/_api/set { key, value }` — only keys in
`SETTABLE_KEYS`, each validated (themes, sizes, the host's voices,
detected editors, on/off for the Experimental switches, which
`BOOLEAN_KEYS` writes as true/false rather than as words). Writes go through `setConfigValue`
(`_shared-ts/config/write.ts`): jsonc-parser edits the text, so the
comments `sky init` wrote survive; the write is atomic. The client
applies changes optimistically and falls back to a reload on refusal.

`POST /settings/_api/google/category { email, category }` writes one
account's side, since an email is a key `SETTABLE_KEYS` cannot list. It
takes an address with one @ and no spaces, and only Professional or
Personal.

The service process keeps its boot-time `#config`; everything the page
serves is read fresh per request (`load()`), and the voice is resolved
per session, so no restart is needed for any settable key.

### Password manager setup boundary

`createBrowserAutomationHost.ts` supplies account discovery and a vault-only
inspection function. Its host cannot list items, read fields, generate codes,
or modify provider items. `GET /settings/_api/browser-automation` reads saved
account/vault metadata only, including after restart or provider locking.
Native SDKs can renew authorization internally, so even a vault listing belongs
behind an explicit Connect or Refresh action, never a Settings page load.

The setup API supports Connect, Refresh, Disconnect, vault exclusions, and opening
1Password settings. Native browser setup can prepare Apple’s authenticated browser
extension, save the explicit Brave choice, or open macOS AutoFill preferences.
These operations cannot read credentials or approve a browser task; the
[private browser owns their use](../../../../lib/browser/docs/README.md#apple-passwords-passkeys-and-sso).
Responses are not cached and provider errors are sanitized.
The entire former `/settings/_api/credentials` API returns 410, including secret
reads, OTP, inspection and generic mutations. Keeping a reveal endpoint while
removing its UI would preserve the original exposure.

Password-manager setup is **not authorization to retrieve a credential**. An explicit
existing-Brave connection grants use of that browser’s sessions for requested tasks;
its token stays in Keychain, and Settings only returns connection preferences. See
[existing Brave](../../../../lib/browser/docs/README.md#existing-brave). For password
manager retrieval there is one exception: a batch integration with a dedicated browser profile may read,
without a dialog, the Login item whose saved website names its own origin (see
[stored logins](../../../../lib/browser/docs/README.md#stored-logins)).
The page reports native approval availability for configured accounts on macOS;
there is no API or setting that approves a task or drives the browser. The
[private browser worker](../../../../lib/browser/docs/README.md#credential-backed-tasks)
enforces independent native approval for each site's login and owns the task session. Local-request checks alone are not that boundary. Provider access
during setup does not establish it either.

`state/credentials/sources.json` remains at its existing path to preserve account
identities and exclusions. The old destination field is accepted for compatibility,
never exposed or used. The library's bindings file is left alone. State uses strict
schemas, a process lock and atomic owner-only writes. Invalid state is reported
rather than silently reset. `lib/credentials/passwordManagers.ts` owns this shared
preference schema; the settings host and private browser read the same rules.
No secret or session token is persisted here.

### Existing connection and Keychain setup routes

Keychain timeouts, background access, and the explicit Restore access action
follow the [shared Keychain contract](../../../../lib/secrets/docs/README.md).

Under `/settings/_api/connections/`: `POST secret { category, name,
type: 'secret', value }` or `{ …, type: 'login', user, pass }` stores one
entry (a same-type write keeps the entry's `created`; a change of type
starts fresh); `DELETE secret/:category/:name` removes one and 404s an
unknown name; `POST google/client { clientId, clientSecret }` stores the
OAuth client pair; `POST google/connect` starts a sign-in and answers
`{ id, url }` (409 without a client); `GET google/connect/:id` answers
`waiting`, `done` with the email, or `failed` with the reason. `GET
typesafe` answers the TypeSafe row (a key stored, its tail, the models it
may use, or `refused` / `error`); `POST typesafe/key { key }` asks
TypeSafe first and stores the key only when it is accepted, else 400 with
the reason; `DELETE typesafe` removes it. Names are
`SECRET_CATEGORY` / `SECRET_NAME` — letters, digits, dots, dashes, underscores, and
for names `@` and `+`, since an account email is a name; a blank name
becomes the filler. Values are never read back whole through these legacy routes: `GET connections`
answers the index plus, for a login, its username, and for a long key,
its last four characters. The Connections page requests `?accountsOnly=true`,
which skips generic secret reads. The legacy list remains compatible with
existing API consumers; Browser automation does not consume it.

The legacy write route validates with the pure rules in
`secretValidation.ts` and returns `{ field, message }` with status 400
for invalid input. Service-specific setup forms own their validation
and error presentation.

## The host seam

`createSettingsRoutes(host)` — the host (`SettingsHost`) is the
machine: config snapshot, voices, model rows, editor detection, memory
count, git build, write, reveal (`open`, macOS), and `connections` — a
`ConnectionsHost`: the keychain (`SecretsProvider`), the environment,
the keyed providers, Google's sign-in, agent-slack. Its `browserAutomation` host
owns password manager setup metadata only. Tests
script every part; route and browser tests use fake SDK clients and
`TestSecretsProvider`, never real accounts or the real Keychain.

## Where each kind of setting lives (ruled 2026-08-30)

| Kind | Home |
| --- | --- |
| Preferences and app wiring | `~/.sky/config.jsonc` — readable, shareable |
| Account integration grants | the keychain, through `context.secrets`; managed by Connections |
| Website logins, passkeys and verification codes | the user's password manager; no inventory or secret reads in Settings |
| Password manager setup preferences | `state/credentials/sources.json` — metadata only, not sign-in authorization |
| Provider API keys | the keychain, under the provider's name (Cerebras and TypeSafe read their entries; TypeSafe's has a row of its own, checked with TypeSafe); `src/.env` is still what OpenAI and Anthropic read, and the page does not show those — keychain-first for them is the open rung |

The config file stays free of secrets. Connections shows presence, usernames
and key tails. Settings has no endpoint for revealing stored credential values.
