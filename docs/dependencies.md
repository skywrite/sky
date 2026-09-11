---
created: 2026-08-11
updated: 2026-09-09
---

# Dependencies

What Sky needs installed, and what breaks if it isn't there.

Sky shells out to a handful of external programs. Four are required; the rest are
per-feature and only matter if you use the feature. Nothing here is bundled — Sky
runs from a git clone and calls what's already on your machine.

## Required

Without these, Sky does not run at all. Setup is in [INSTALL.md](INSTALL.md).

| Requirement | Why | Check |
|---|---|---|
| macOS | The service is launchd-based, and several commands call macOS-only tools | `uname` → `Darwin` |
| [Bun](https://bun.sh) 1.4+ | Runtime, package manager, test runner | `bun --version` |
| git | Cloning and updating the repo. On macOS it arrives with Apple's Command Line Tools; [INSTALL.md step 2](INSTALL.md#2-install-git) walks through the install dialog | `xcode-select -p` on macOS, then `git --version` |
| An AI provider API key | Journaling questions, `ai:chat`, summaries | see INSTALL.md step 6 |

An editor is a soft requirement: every `*:new` and `*:open` command hands the file
to one. Sky resolves it from the `EDITOR` (or `VISUAL`) environment variable, so
`export EDITOR=code` in your shell profile is what makes those commands open
anything.

## Optional — install yourself

None of these ship with macOS. Each is needed by specific commands, listed below.
If you never run those commands, you never need the tool.

| Tool | Needed by | Install |
|---|---|---|
| **ffmpeg** (with ffprobe) | `audio:transcript:create` when the input is a `.caf` recording | `brew install ffmpeg` |
| **pandoc** | `summary:doc` on `.pptx` and `.keynote` files | `brew install pandoc` |
| **agent-slack** | every `slack:*` command | [stablyai/agent-slack](https://github.com/stablyai/agent-slack) |
| **device-location** | `util:location`, `day:location`, and the location lookup inside `day:start` | [skywrite/DeviceLocation](https://github.com/skywrite/DeviceLocation) |
| **gui-prompt** | the dialog in `util:desktop:rename` | [skywrite/gui-prompt](https://github.com/skywrite/gui-prompt) |
| **librsvg** | `google:agent` background art | `brew install librsvg` |
| A Chromium-family browser | all `google:*` browser automation | Brave, Chrome, Chromium, or Edge in `/Applications` |
| VS Code's `code` CLI | the review step of `person:move:bulk` | VS Code → *Shell Command: Install 'code' in PATH* |
| Editor | the VS Code extension's *Open with Editor* command | [editor.io](https://example.com) |

A few notes on the ones with surprises in them:

**ffprobe** ships inside the same Homebrew formula as ffmpeg, so installing one
gets both.

**agent-slack** is the widest dependency here — Slack support is entirely a
wrapper around it. `slack:auth` will tell you where to get it; the export and
follow-up commands assume it is already there and fail less helpfully.

**device-location** exists because macOS puts Core Location behind an entitlement
only a signed app bundle can request, so a plain CLI cannot ask for coordinates.
Without it, `--mobile` still works — that path gets a fix from your phone over a
QR code and needs nothing installed.

**gui-prompt** is a native dialog that asks a question and prints the answer;
`util:desktop:rename` is its only caller. Its `install.sh` compiles the Swift
source with `swiftc`, so Apple's Command Line Tools are needed once, at install
time — the binary itself needs nothing beyond macOS. Put it in a directory on the
PATH of whatever runs the command: a launchd job does not read your shell
profile, so a directory added only in `.zshrc` is invisible to it.

**librsvg** is the preferred SVG renderer but not the only one. If it is missing,
`google:agent` falls back to a Chromium-family browser, then to `qlmanage`, and
only fails if all three are absent.

**A Chromium-family browser** is also what `slack:auth` imports cookies from, and
Brave specifically is the one it knows how to read.

### Failure behavior

Most of these fail with a message naming the tool and how to get it. Two do not,
and are worth knowing about before you go debugging:

- `person:move:bulk` discards the result of its `code` call, so a missing `code`
  CLI means the review step silently does nothing.
- The VS Code *Open with Editor* command fails opaquely when Editor is absent.

## Bundled with macOS

These need no installation, but they are the concrete reason Sky is macOS-only.
Listed so a port has a checklist rather than a surprise.

| Tool | Used for |
|---|---|
| `open` | opening attachment folders, OAuth and QR flows |
| `sips` | converting HEIC/HEIF images to PNG for AI vision |
| `textutil` | reading `.docx`, `.doc`, `.rtf`, `.odt`, `.pages` in `summary:doc` |
| `launchctl` | the background service (`services:*`) |
| `security` | reading Slack tokens from the Keychain |
| `qlmanage` | last-resort SVG rasterizer |
| `ioreg` | idle detection |
| `ps` | recovering a wedged automation browser |
| `trash` | the Trash button in `util:desktop:rename` (macOS 15 and later) |
