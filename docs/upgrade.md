---
created: 2026-08-26
updated: 2026-08-26
---

# Upgrading Sky

> **Reading this as an AI coding agent?** (Claude, Codex, or otherwise — that's the
> intended reader.) Read the whole file first, then execute the numbered steps in order.
> Each step ends with a verification command and the output it must produce. If a
> verification fails, stop and report which step failed and what it printed; do not
> improvise past it.
>
> **Consent boundary.** The user asking you to upgrade covers: fetching, reading the
> commit range, the pull itself, reinstalling dependencies, rebuilding the command
> manifest, and restarting the service. It does **not** cover: writing to the notebook,
> editing `~/.sky/config.jsonc`, re-running `sky init`, or upgrading Bun. Each of those
> needs its own yes, with the evidence (dry-run output, the relevant diff) shown first.

Sky has no version numbers, no releases, no changelog file. `main` is the release, and
the commit log — written in [Conventional Commits](../CONTRIBUTING.md) precisely so it
can be read this way — is the changelog. Upgrading is therefore not `git pull` and hope:
some commits change the *shape* of data your notebook already contains, and a blind pull
gives you new code reading old files. The job of this document is to close that gap:
read what is about to land, decide what it means for **this machine's** notebook and
config, then apply it deliberately.

This is the opposite of mainstream package management, and deliberately so for now. The
quick-and-dirty path is [INSTALL.md → Updating](INSTALL.md#updating); this file is the
careful path.

One principle to lean on while judging commits: **Sky's parsers accept every shape the
notebook has ever legitimately contained.** Format changes ship with readers that still
parse the old form, and migrations ship as separate commands that are dry-run by default
(`--execute` to act) and exist to *catch the files up*, not to keep them readable. So the
expected answer to "will my existing files still parse?" is yes. If you read a commit
range and conclude the answer is no and no migration command ships in it, that is a bug:
stop before pulling and report the commits.

## 1. Find the install

The launcher on `PATH` is a symlink into the clone, so the clone locates itself:

```bash
SKY_REPO="$(dirname "$(dirname "$(readlink -f "$(command -v sky)")")")"
echo "$SKY_REPO"
```

The default from the install guide is `~/sky-app`, but any location is legal. If there is
no `sky` on `PATH`, ask the user where the clone lives — do not guess.

**Verify:**

```bash
ls "$SKY_REPO/bin/sky" "$SKY_REPO/src/package.json"
```

**Must print** both paths with no error.

## 2. Pre-flight

```bash
git -C "$SKY_REPO" status --porcelain
git -C "$SKY_REPO" branch --show-current
git -C "$SKY_REPO" rev-parse --short HEAD
```

**Must print**: nothing from the first command (a clean tree — `src/.env` is gitignored
and will not appear), `main` from the second. **Write down the third** — it is the
rollback point, and it goes in your final report.

If the tree is dirty, stop and show the user what changed; local edits are theirs to
stash or keep. If the branch is not `main`, stop and ask — this machine is doing
development, and integrating upstream is the developer's call, not yours.

## 3. Fetch and scope

```bash
git -C "$SKY_REPO" fetch origin
git -C "$SKY_REPO" rev-list --count HEAD..origin/main   # behind by
git -C "$SKY_REPO" rev-list --count origin/main..HEAD   # ahead by
```

**Must print** two numbers. If *ahead* is not `0`, stop and ask (local commits exist —
same reasoning as the branch check). If *behind* is `0`, report "already up to date" and
stop; there is nothing else to do.

## 4. Read the changelog — all of it

Summaries first, oldest to newest, and read **every line** — the whole point of this
procedure is that a human-shaped judgment happens here:

```bash
git -C "$SKY_REPO" log --reverse --oneline HEAD..origin/main
```

Then the full messages — the bodies carry the why, and any migration instructions:

```bash
git -C "$SKY_REPO" log --reverse HEAD..origin/main
```

And the mechanical tripwires — files whose diffs demand local action regardless of what
the summaries say:

```bash
git -C "$SKY_REPO" diff --stat HEAD origin/main -- \
  src/package.json src/bun.lock package.json bun.lock \
  src/.env.example src/_shared-ts/config.ts services/ extensions/vscode/
```

Map what you find to local consequences:

| Signal in the range | What it means locally | Action after the pull |
|---|---|---|
| Commits changing where notebook files live or how they parse — `nbfs` scope, layout/re-file/rename language, frontmatter field changes | Your files are in the old shape; new code still reads them | Find the migration command shipped in those commits. Dry-run it, show the user, get a yes, `--execute` |
| `feat(config)` / `init` changes; `src/_shared-ts/config.ts` diff adds keys | `~/.sky/config.jsonc` lacks new keys; defaults usually apply | Tell the user what is now configurable ([Overview → Configuration](overview.md#configuration)); edit config only with a yes |
| `chore(deps)` naming Bun or an engine floor (e.g. `377a0b23 chore(deps): require Bun 1.4`) | The installed runtime may now be too old | `bun --version` **before anything else runs**; if below the floor, get a yes for `bun upgrade` |
| `src/.env.example` diff | New optional provider keys exist | Report which features want them; **never** write, read back, or echo key values |
| `services/` diff | The installed plist is a stale render — pulling never updates it (repo files are `{{HOME}}` templates) | User re-runs `sky init` (it asks before overwriting and preserves settings), then `--unload` / `--load` / `--start` |
| `extensions/vscode/` diff | Extension deps or code changed | `npm install` in `extensions/vscode`; user fully restarts VS Code — a window reload is not enough |
| Commits adding or renaming commands | The command manifest cache is stale | Covered by the unconditional rebuild in step 7 |
| Prompt files (`*.prompt.md`), service internals, refactors | No local action | The service restart in step 8 covers it |

For every commit whose summary suggests it changes how notebook files are *written or
parsed*, apply the principle from the top of this file. Never invent a migration of your
own — only run migration commands the range itself shipped.

Close the step by telling the user what you found: how many commits, the notable ones,
which actions from the table apply, and which of them need their yes. Then proceed.

## 5. Pull

The tree is clean and not ahead, so this must fast-forward; if it refuses, stop.

```bash
git -C "$SKY_REPO" pull --ff-only origin main
```

**Verify:**

```bash
git -C "$SKY_REPO" rev-parse HEAD origin/main
```

**Must print** the same hash twice.

## 6. Reinstall dependencies — twice

Same shape as [installation step 3](INSTALL.md#3-install-dependencies--twice): `src/` is
the install that matters, the root is a separate thin workspace. Run both every upgrade —
they are cheap no-ops when nothing changed:

```bash
cd "$SKY_REPO/src" && bun install --frozen-lockfile
cd "$SKY_REPO"     && bun install --frozen-lockfile
```

**Verify:**

```bash
ls "$SKY_REPO/src/node_modules/ai" "$SKY_REPO/src/node_modules/graphql-yoga"
```

**Must print** both paths with no error.

## 7. Rebuild the command manifest

Commands are discovered by file path and cached; a pull that adds or renames commands
leaves the cache pointing at the old world. Rebuild unconditionally:

```bash
sky cli:commands --rebuild
```

**Verify:**

```bash
sky test:hello
```

**Must print** `Hello from the task runner!`.

## 8. Run the migrations you identified

Only the ones step 4 found, and only in this shape: dry-run, show the user the output,
get a yes, then `--execute`. Never chain the dry-run and the execute in one breath. For
example, when the range re-files the time tree:

```bash
sky nbfs:migrate             # dry-run: prints what would move
sky nbfs:migrate --execute   # only after the user has seen the dry-run and said yes
```

The notebook is plain files and it belongs to the user. If a dry-run shows a large move
and the user has no versioning or backup of their own on the notebook directory, suggest
taking a copy first.

## 9. Restart the service — only if they run it

```bash
sky services sky-service --restart
```

If step 4 flagged a `services/` template change, the re-render comes first: the user runs
`sky init`, then `sky services sky-service --unload`, `--load`, `--start`.

**Verify:**

```bash
sky services
```

**Must show** `sky-service` loaded and running. Logs land in `/tmp/sky-service/` if it
does not come back.

## 10. Report

Tell the user, in this order: the rollback hash from step 2 and the new `HEAD`; how many
commits landed; what you did (installs, rebuild, migrations run and their counts,
service restarted); and what remains theirs (new config keys, new `.env` keys, an `init`
re-render, a VS Code restart). Then have them run one command they actually use daily —
that, not `test:hello`, is the real smoke test.

## If it broke

The pull was a fast-forward from a clean tree, so rolling back is mechanical — reset to
the hash recorded in step 2, then redo the machinery steps against the old code:

```bash
git -C "$SKY_REPO" reset --hard <rollback-hash>
cd "$SKY_REPO/src" && bun install --frozen-lockfile
cd "$SKY_REPO"     && bun install --frozen-lockfile
sky cli:commands --rebuild
sky services sky-service --restart   # only if they run it
```

A migration that already ran `--execute` is **not** undone by rolling back the code —
that is what the dry-run gate and the backup suggestion in step 8 were for. Report what
state the notebook is in rather than attempting a creative reverse migration.

Then report the failure upstream with the commit range (`<rollback-hash>..origin/main`)
and the verification output that failed.
