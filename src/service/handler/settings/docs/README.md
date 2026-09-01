---
created: 2026-08-30
updated: 2026-08-31
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
- **Notebook** — where things live (with Show in Finder), the editor
  (detected commands, saved to `editor`), export and drop folders.
- **Advanced** — the configuration view kept from the first rung:
  every key, its value, and its provenance (file / default /
  `env · SKY_DIR`). `ENV_OVERRIDES` is shared with the loader so the
  two cannot drift. Plus "Open config file".
- **About** — the build (git, cached per process) and the service.

Deferred by ruling: **Connections** (Slack/Google accounts, API keys)
waits for the keychain rung; keychain and env stay untouched.

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

## The host seam

`createSettingsRoutes(host)` — the host (`SettingsHost`) is the
machine: config snapshot, voices, model rows, editor detection, memory
count, git build, write, reveal (`open`, macOS). Tests script every
part; nothing in the route tests touches the real machine.

## Where each kind of setting lives (ruled 2026-08-30)

| Kind | Home |
| --- | --- |
| Preferences and app wiring | `~/.sky/config.jsonc` — readable, shareable |
| Account credentials | the keychain, through `context.secrets` (deferred) |
| Provider API keys | `src/.env` today; keychain-first proposed, undecided |

The config file stays free of secrets. This page never shows a key or
a credential; when Connections lands it shows presence, never values.
