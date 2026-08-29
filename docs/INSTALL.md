---
created: 2026-07-28
updated: 2026-08-29
---

# Installing Sky

> **Reading this as an AI coding agent?** Good — that's the intended path. Read the whole
> file first, then execute the numbered steps in order. Each step ends with a verification
> command and the output it must produce. If a verification fails, stop and report which
> step failed and what it printed; do not improvise past it. One step (2, on a fresh Mac)
> needs the person to click through a system dialog you cannot see; the step says exactly
> what to tell them — wait for them rather than working around it. Check `uname` before
> step 1: if the machine is not a Mac, tell the person this guide is untested there and let
> them decide whether to continue. Never overwrite an existing `~/.sky/config.jsonc` or an
> existing notebook directory without asking.

Sky is **not published to npm**. There is no `npm i -g sky`. It runs from a git clone on
[Bun](https://bun.sh), and `bin/sky` is a shell launcher you put on your `PATH`. This is
deliberate: Sky reads and writes your entire notebook, and you should be able to read every
line of what does that.

**Sky is macOS-only for now.** It is developed, run, and tested on a Mac, and this guide
assumes one. It has not been tested on Windows or Linux. Parts of the CLI are plain bash
and Bun and may work on Linux; the background service is launchd-based and a handful of
commands call macOS-only tools, so expect gaps. Windows is untried entirely. Supporting
both is planned — in time this gets fixed — but today, if you are not on a Mac, you are
off the tested path.

Budget about five minutes — plus the Command Line Tools download in step 2 if the Mac has
never had them, which is the one slow part.

## Before you start

| Requirement | Why | Check |
|---|---|---|
| macOS | The only tested platform — see above | `uname` → `Darwin` |
| [Bun](https://bun.sh) 1.4+ | Runtime, package manager, test runner | `bun --version` |
| git | Cloning and updating the repo | step 2 — on a fresh Mac, do not run `git` blind |
| An AI provider API key | Journaling questions, `ai:chat`, summaries | see step 6 |

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

## 2. Install git

Sky is cloned and updated with git, so it has to exist before the next step. What
"install git" means depends on the machine.

**macOS.** Every Mac ships a `/usr/bin/git`, but it is a stub until Apple's **Command Line
Tools** are installed. Until then *any* git command — `git --version` included — does not
run git. It opens a system dialog on the person's screen ("The 'git' command requires the
command line developer tools. Would you like to install the tools now?"), prints this to
stderr, and exits 1:

```
xcode-select: note: No developer tools were found, requesting install.
Choose an option in the dialog to download the command line developer tools.
```

An agent cannot see or click that dialog. So check for the tools without triggering it:

```bash
xcode-select -p
```

- Prints a path (`/Library/Developer/CommandLineTools`, or an `Xcode.app/…/Developer`
  path): the tools are installed. Skip to **Verify**.
- Prints `xcode-select: error: unable to get active developer directory` (exit 2): not
  installed. Continue.

Start the install:

```bash
xcode-select --install
```

This returns immediately with `xcode-select: note: install requested for command line
developer tools`. The actual work happens in the dialog it opened. **Agent: stop here and
tell the person, in these words or close to them:**

> A macOS dialog has opened asking to install the command line developer tools. Click
> **Install** (not "Get Xcode" — full Xcode is many gigabytes and unnecessary), accept the
> license, and let it finish. The download is around a gigabyte and usually takes five to
> twenty minutes. Tell me when it says the software was installed.

Then wait for the person's word. Do not try to work around the dialog — Homebrew needs the
same tools, so there is no other route — and do not run any `git` command while it is
open, since each one opens another dialog. Do not block in a `sleep` loop either; long
sleeps time out in most agent shells. When the person says it finished, re-run
`xcode-select -p` and expect a path.

If `xcode-select --install` instead prints `Can't install the software because it is not
currently available from the Software Update server`, Apple is not serving the tools for
this macOS version. The person signs in at <https://developer.apple.com/download/all/>,
downloads "Command Line Tools for Xcode" matching their macOS, and runs the `.pkg`. Then
re-run `xcode-select -p`.

**Linux / Windows.** Untested, as noted at the top. Linux: `sudo apt install git`
(Debian/Ubuntu) or the distro equivalent. Windows: Git for Windows from
<https://git-scm.com/download/win>. The rest of this guide assumes a POSIX shell.

**Verify:**

```bash
git --version
```

**Must print** `git version 2.` followed by a version — on macOS it looks like
`git version 2.50.1 (Apple Git-155)`. If it prints the `xcode-select: note:` text instead,
the tools are not installed yet: the dialog is still open or the install has not finished.
Do not proceed.

## 3. Clone the repo

Any location works — Sky finds its own code directory from the launcher's real path, so
you are not locked to a particular folder. This guide uses `~/sky-app`.

> **Do not clone to `~/sky`.** macOS filesystems are case-insensitive by default, so
> `~/sky` is the same folder as `~/Sky` — the default notebook directory offered in
> step 7 — and `sky init` would create your notebook inside the clone.

```bash
git clone https://github.com/skywrite/sky.git ~/sky-app
cd ~/sky-app
```

**Verify:**

```bash
ls bin/sky src/package.json
```

**Must print** both paths with no error.

## 4. Install dependencies — twice

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

## 5. Put `sky` on your PATH

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

## 6. Add API keys

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
set `ai.models` in your config after step 7 — see
[Overview → Configuration](overview.md#configuration). The remaining keys in `.env.example`
(Gemini, Mistral, Groq, xAI, Perplexity) are optional and only used if you point a model
role at them.

> **Agents:** never write a real key you were not explicitly given, and never echo the
> contents of `.env` back into a transcript or commit it. `src/.env` is gitignored — keep
> it that way.

## 7. Initialize the notebook

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

## 8. Start your first day

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
| `command not found: sky` | `~/.local/bin` not on `PATH` | Re-do step 5, open a new shell |
| `bun could not be found. Exiting.` | Bun missing or not on `PATH` | Step 1; check `~/.bun/bin` is on `PATH` |
| Any `git` command prints `xcode-select: note: No developer tools were found` and a dialog appears | Apple's Command Line Tools are not installed | Step 2: click **Install** in the dialog, wait for it to finish, re-run `git --version` |
| `Can't install the software because it is not currently available from the Software Update server` | Apple is not serving the tools for this macOS | Step 2: manual download from developer.apple.com |
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
