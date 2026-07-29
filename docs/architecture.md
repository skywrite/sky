---
created: 2026-07-28
updated: 2026-07-28
---

# Architecture

How the code is organized, and how to add to it. If you want to understand the *notebook*
rather than the code, read [Overview](overview.md) first.

## Layout

```
sky/
  bin/
    sky                    # CLI entry point — the thing you symlink onto your PATH
    sky-service            # service launcher, invoked by launchd
  services/                # launchd plist templates ({{HOME}}-style placeholders)
  docs/                    # this documentation
  extensions/
    vscode/                # completions, day-file gutters, AI summarize commands
  packages/                # @skywrite/core, @skywrite/commands — public surface for
                           #   commands that live outside this repo
  src/                     # the application (TypeScript on Bun) — deps live HERE
    _shared-ts/
      models/              # document models: Day, Person, Meeting, Journal, Streak, ...
      nbfs/                # notebook filesystem: dayFile, dayDir, weekDir, readDay
      universal/dates/     # PlainDate, PlainDateTime, ZonedDateTime
      fs/                  # cross-runtime filesystem operations
      sys/                 # cross-runtime process/system operations
      config/              # config loading and defaults
    commands/
      all/                 # every command — path is the name
      lib/                 # the command runner itself
    lib/                   # application libraries (streaks, nbfs writers, services, tui)
    service/               # GraphQL server + file watcher + document stores
    mcp/                   # MCP server
    test/                  # test infrastructure
    tmpl/                  # document templates
```

## Convention-based commands

The file path **is** the command name. There is no registry to update, no import list to
maintain, no place to forget to add your command.

```
commands/all/day/start.ts       → sky day:start
commands/all/journal/new.ts     → sky journal:new
commands/all/ai/chat/mod.ts     → sky ai:chat
```

`bin/sky` translates colons to slashes and hands the path to the runner. A `mod.ts` in a
directory becomes the command for that directory, which is how a command with helper files
keeps them next to itself.

The scanner skips any path segment named `lib` or starting with `_`, so helpers can sit
next to the commands that use them without becoming commands themselves. Put them in
`<group>/lib/` — the `_`-prefixed variants elsewhere in the tree are historical.

Discovered commands are cached in `~/.sky/sky.commands.json` for fast lookup and shell
completion. Run `sky cli:commands --rebuild` after adding, renaming, or removing one.

## Anatomy of a command

```typescript
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  name: Arg.string('Name of the item'),
  verbose: Flag.boolean('Show details', { short: 'v', default: false }),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'category:command': { params: Params; result: undefined }
  }
}

export default class MyCommand extends Command {
  static override description: CommandDescription = {
    name: 'category:command',
    description: 'What this command does',
    params,
  }

  async run({ context, args }: CommandArgs<Params>): Promise<CommandResult> {
    const { output } = context
    const { name, verbose } = args

    output.log(`Hello, ${name}!`)
    return CommandResult.success()
  }
}
```

`params` is the single source of truth: it types `args`, generates `--help`, and feeds
shell completion. The `CommandTypesRegistry` declaration is what lets one command call
another with full type safety.

Output goes through `context.output`, never `console.log` — that's what allows a command to
be composed into another one and have its output captured rather than printed.

## Commands outside this repo

Point `commands.dirs` in `~/.sky/config.jsonc` at a directory and its commands are
discovered exactly like the built-ins. External commands import the public
`@skywrite/*` packages rather than the `#`-prefixed private aliases, which only resolve
inside `src/`.

## The service

`src/service/` is a GraphQL server (graphql-yoga) plus a chokidar file watcher, run as a
launchd agent on port 9999 by default.

It keeps document stores in memory so that queries over the notebook are instant instead of
re-walking thousands of markdown files per call. The watcher keeps those stores current as
files change on disk — from Sky, from your editor, or from a sync client. Consumers are
`ai:chat` context gathering, `markdown:sel`, and the VS Code extension's completions, which
subscribe over a websocket for live updates.

The GraphQL schema is generated from the document models: `bun run dev:schema:generate`.
Nothing works if the schema drifts from the models, so `bun run dev:schema:validate` guards
that.

Everything in Sky works without the service running. It's a cache, not a dependency.

## Dates — never use JS `Date`

Use `PlainDate`, `PlainDateTime` and `ZonedDateTime` from `#universal/dates/nbdt/mod.ts`
exclusively. JS `Date` silently mixes local and UTC and shifts by a day at timezone
boundaries, which in a notebook keyed by date means work filed under the wrong day.

`bun run dev:lint` fails the build on `new Date()`, `.toISOString()`, and friends. When a
third-party library hands back a `Date`, convert at the boundary and never let it travel.

Which type to reach for, and the extended-hours arithmetic that makes the notebook's day
boundaries work, are in [Notebook time and NBFS](nbfs.md).

## Imports

Subpath imports, configured in `src/package.json`:

```typescript
import * as config from '#config'
import { readTextFile } from '#shared/fs/mod.ts'
import { runCommand } from '#lib/sys/mod.ts'
import { Command, CommandResult } from '#commands/mod.ts'
```

| Alias | Resolves to |
|---|---|
| `#config` | `_shared-ts/config.ts` |
| `#shared/*` | `_shared-ts/*` |
| `#universal/*` | `_shared-ts/universal/*` |
| `#lib/*` | `lib/*` |
| `#commands/*` | `commands/*` |
| `#service/*` | `service/*` |
| `#test` | `test/mod.ts` |

## Toolchain

| Tool | Purpose |
|---|---|
| [Bun](https://bun.sh) | Runtime, package manager, test runner |
| [oxfmt](https://oxc.rs) | Formatting (Rust — 1000+ files in well under a second) |
| [oxlint](https://oxc.rs) | Linting (Rust, ESLint-compatible) |
| [tsc](https://www.typescriptlang.org) | Type checking (TypeScript 7, native Go binary) |

All from `src/`:

```bash
bun run dev:fmt          # format
bun run dev:lint         # oxlint + banned-API and task-shape checks
bun run dev:typecheck    # tsc --noEmit
bun run dev:test:unit    # unit tests (1900+ across 424 files)
```

**All three of fmt, lint and typecheck are mandatory after changing code.**

## Testing

- Runner: `bun test`, files colocated with source as `*_test.ts`
- Assertions are riteway-style: `assert({ given, should, actual, expected })`
- One file: `bun test path/to/file_test.ts`
- Everything: `bun run dev:test:unit`

Use `dev:test:unit` rather than a bare `bun test` — the latter picks up editor end-to-end
suites that need a real VS Code host.

## Dependencies

`bun add <package>` from `src/`. The repo has two independent installs and only one of them
matters:

| Directory | Contents |
|---|---|
| `src/` | **The application.** Every runtime dependency lives here. |
| `./` (root) | Thin `packages/*` workspace, no third-party deps — installing here is nearly a no-op. |

Restoring a fresh checkout without touching lockfiles:

```bash
cd src && bun install --frozen-lockfile
cd ..  && bun install --frozen-lockfile
```

## Contributing

Conventions, PR size expectations and commit format are in
[CONTRIBUTING.md](../CONTRIBUTING.md). Project rules for AI coding agents working in this
repo are in [AGENTS.md](../AGENTS.md).
