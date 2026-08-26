---
created: 2026-07-28
updated: 2026-08-26
---

# Installing Sky

> **Reading this as an AI coding agent?** Good — that's the intended path. Read the whole
> file first, then execute the numbered steps in order. Each step ends with a verification
> command and the output it must produce. If a verification fails, stop and report which
> step failed and what it printed; do not improvise past it. Never overwrite an existing
> `~/.sky/config.jsonc` or an existing notebook directory without asking.

Sky is **not published to npm**. There is no `npm i -g sky`. It runs from a git clone on
[Bun](https://bun.sh), and `bin/sky` is a shell launcher you put on your `PATH`. This is
deliberate: Sky reads and writes your entire notebook, and you should be able to read every
line of what does that.

Budget about five minutes.

## Before you start

| Requirement | Why | Check |
|---|---|---|
| macOS | Sky is developed and run on macOS | `uname` → `Darwin` |
| [Bun](https://bun.sh) 1.4+ | Runtime, package manager, test runner | `bun --version` |
| git | Sky runs from a clone | `git --version` |
| An AI provider API key | Journaling questions, `ai:chat`, summaries | see step 5 |

Linux is not tested. The CLI is plain bash + Bun and will likely work; the background
service is launchd-based and macOS-only, as are a few commands (device location, Editor
integration).

Individual features need extra tools — ffmpeg for audio conversion, `agent-slack` for
Slack, `device-location` for location, and a handful of others. None are needed to
install or to start journaling. [Dependencies](dependencies.md) lists what each one
unlocks and what happens without it.

---

## 1. Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

Restart your shell, then verify:

```bash
bun --version
```

**Must print** `1.4.0` or higher — Sky's date layer is migrating to the standard
`Temporal` API, which Bun ships enabled from 1.4. If `bun: command not found`, add
`~/.bun/bin` to your `PATH` and re-check.

## 2. Clone the repo

Any location works — Sky finds its own code directory from the launcher's real path, so
you are not locked to a particular folder. This guide uses `~/sky-app`.

> **Do not clone to `~/sky`.** macOS filesystems are case-insensitive by default, so
> `~/sky` is the same folder as `~/Sky` — the default notebook directory offered in
> step 6 — and `sky init` would create your notebook inside the clone.

```bash
git clone https://github.com/skywrite/sky.git ~/sky-app
cd ~/sky-app
```

**Verify:**

```bash
ls bin/sky src/package.json
```

**Must print** both paths with no error.

## 3. Install dependencies — twice

There are two independent installs, and the one that matters is `src/`. Installing only at
the repo root does **not** install the app; the root is a thin workspace with no
third-party dependencies.

```bash
cd ~/sky-app/src && bun install --frozen-lockfile
cd ~/sky-app     && bun install --frozen-lockfile
```

`--frozen-lockfile` installs exactly what `bun.lock` pins and fails rather than rewriting
it. It still installs missing packages, so it is also the right command after a partial
sync or a machine move.

**Verify:**

```bash
ls ~/sky-app/src/node_modules/ai ~/sky-app/src/node_modules/graphql-yoga
```

**Must print** both paths with no error.

## 4. Put `sky` on your PATH

Symlink the launcher. Do not copy it — it locates the repo by resolving its own symlink,
so a copy elsewhere breaks.

```bash
mkdir -p ~/.local/bin
ln -sf ~/sky-app/bin/sky ~/.local/bin/sky
```

If `~/.local/bin` is not already on your `PATH`, add it (zsh shown):

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

**Verify:**

```bash
sky test:hello
```

**Must print** `Hello from the task runner!`. If you get `bun could not be found`, revisit
step 1. If you get `command not found: sky`, your `PATH` change did not take effect.

## 5. Add API keys

Keys live in `src/.env` — never in `~/.sky/config.jsonc`, which is meant to be shareable.

```bash
cp ~/sky-app/src/.env.example ~/sky-app/src/.env
```

Then edit `~/sky-app/src/.env` and fill in at least one provider:

```bash
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

Sky's defaults use **Anthropic** for the strong reasoning model and **OpenAI** for the fast
and transcription models, so both keys is the frictionless setup. To run on one provider,
set `ai.models` in your config after step 6 — see
[Overview → Configuration](overview.md#configuration). The remaining keys in `.env.example`
(Gemini, Mistral, Groq, xAI, Perplexity) are optional and only used if you point a model
role at them.

> **Agents:** never write a real key you were not explicitly given, and never echo the
> contents of `.env` back into a transcript or commit it. `src/.env` is gitignored — keep
> it that way.

## 6. Initialize the notebook

```bash
sky init
```

This is interactive. It asks three questions and defaults are fine for all of them:

| Prompt | Default | What it sets |
|---|---|---|
| Where should Sky store your notebook? | `~/Sky` | `dir` — your markdown lives here |
| Where should Sky store data files? | `~/Sky-Data` | `userDataDir` — attachments and state, not git-tracked |
| Preferred editor? | `code` | `editor` — what opens files after they're created |

It then creates the notebook directory skeleton, writes `~/.sky/config.jsonc`, installs the
launchd service templates to `~/Library/LaunchAgents`, and builds the command manifest.

If `~/.sky/config.jsonc` already exists it asks before overwriting, and preserves your
`commands.dirs` and `slack.workspace` settings if you say yes.

**Verify:**

```bash
cat ~/.sky/config.jsonc
ls ~/Sky
```

**Must print** a JSONC config, and a directory listing containing `time`, `journal`,
`people`, `projects`, `goals`.

## 7. Start your first day

```bash
sky day:start
```

**Verify:**

```bash
sky day:open
```

**Must open** today's `day.md` in your editor. If the file exists but nothing opens, your
`editor` setting is wrong — fix `editor` in `~/.sky/config.jsonc`.

Installation is done. Go to [Getting started](../README.md#getting-started).

---

## Optional: the background service

Sky's service is a GraphQL server plus a file watcher. It keeps an in-memory index of the
notebook so semantic search, `ai:chat` context gathering, and the VS Code extension's
completions are instant instead of re-scanning thousands of files per call. Everything
works without it; several things are much faster with it.

`sky init` already rendered and installed the plist. Load and start it:

```bash
sky services sky-service --load
sky services sky-service --start
```

**Verify:**

```bash
sky services
```

**Must show** `sky-service` as loaded and running. Logs land in `/tmp/sky-service/` with a
timestamped file per session:

```bash
tail -f "/tmp/sky-service/$(ls -t /tmp/sky-service/*.stdout.log | head -1 | xargs basename)"
```

Management verbs: `--start`, `--stop`, `--restart`, `--load`, `--unload`, `--reload`.

> Do **not** symlink `services/local.sky-service.plist` into `~/Library/LaunchAgents`. The
> file in the repo is a template with `{{HOME}}`-style placeholders; launchd silently
> refuses it and you get `loaded: false` with no logs. The installed plist must be the
> rendered copy `sky init` writes.

## Optional: the VS Code extension

Entity completions for people, projects, orgs, places and tags; day-file gutter handlers
for todos, reminders and checkboxes; and AI summarize commands. It runs unbundled straight
from TypeScript, so there is no build step.

```bash
ln -s ~/sky-app/extensions/vscode ~/.vscode/extensions/sky-ext
cd ~/sky-app/extensions/vscode && npm install
```

Then **fully restart** VS Code — a window reload is not enough, because the extension
scanner only reads the folder at startup. Details and troubleshooting in
[`extensions/vscode/README.md`](../extensions/vscode/README.md).

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `command not found: sky` | `~/.local/bin` not on `PATH` | Re-do step 4, open a new shell |
| `bun could not be found. Exiting.` | Bun missing or not on `PATH` | Step 1; check `~/.bun/bin` is on `PATH` |
| `Cannot find module 'ai'` / missing deps at runtime | Only the root install ran | `cd ~/sky-app/src && bun install --frozen-lockfile` |
| A command isn't found but the file exists | Stale command manifest | `sky cli:commands --rebuild` |
| `sky` runs but writes to the wrong folder | `SKY_DIR` env var overriding config | `echo $SKY_DIR` — unset it, or fix `dir` in the config |
| Service shows `loaded: false`, no logs | An un-rendered plist got installed | `sky init` again, or re-render; never symlink the template |
| AI commands fail with an auth error | Key missing or in the wrong file | Keys go in `src/.env`, not `~/.sky/config.jsonc` |

## Updating

```bash
cd ~/sky-app && git pull
cd src && bun install --frozen-lockfile
sky cli:commands --rebuild
sky services sky-service --restart   # only if you run the service
```

The manifest rebuild matters: commands are discovered by file path and cached, so a pull
that adds or renames commands needs the cache refreshed.

## Uninstalling

```bash
sky services sky-service --stop && sky services sky-service --unload
rm ~/Library/LaunchAgents/local.sky-service.plist
rm ~/.local/bin/sky
rm -rf ~/.sky
rm -rf ~/sky-app
```

Your notebook (`~/Sky`) and data (`~/Sky-Data`) are left alone — they are just markdown
files, and they outlive Sky by design. Delete them yourself if you actually mean to.
