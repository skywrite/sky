# AGENTS.md

Project knowledge for AI coding agents. Claude Code users: see [CLAUDE.md](CLAUDE.md) for additional instructions.

## Project Overview

Sky is a CLI and file system for organizing your life — daily journaling, task management, personal CRM, goal tracking, and AI-powered reflection. Everything is a markdown file with YAML frontmatter. No database, no lock-in.

**The core loop:** Self-reflection → Learning → Action → Accountability

**Vision:** Sky evolves into an AI co-CEO — an agent that knows your goals, relationships, commitments, and context deeply enough to act on your behalf. It starts as a personal operating system (journaling, tasks, CRM) and grows into an autonomous partner that can manage communication, track accountability, and help you scale across everything you're responsible for. The plaintext foundation exists so the AI always has full, unmediated access to your data.

## Tech Stack

| Tool | Purpose |
|------|---------|
| [Bun](https://bun.sh) | Runtime, package manager, test runner |
| TypeScript | All application code |
| [oxfmt](https://oxc.rs) | Code formatting |
| [oxlint](https://oxc.rs) | Linting |
| [tsgo](https://github.com/nicklockwood/tsgo) | Type checking (Go port of tsc) |

## Project Structure

```
sky-oss/
  bin/                   # Shell scripts
    sky                  # CLI entry point (symlink target)
    sky-service           # Service launcher for launchd
  services/              # macOS launchd plist templates
  extensions/            # Editor extensions
    vscode/              # VSCode completions for people, projects, tags
  src/                   # Core application (TypeScript, runs on Bun)
    _shared-ts/          # Shared models, parsers, utilities
      models/            # Core data models (Day, Person, Meeting, Journal, etc.)
      nbfs/              # Notebook filesystem utilities (dayFile, dayDir, weekDir)
      universal/dates/   # Date manipulation (PlainDate, PlainDateTime, ZonedDateTime)
      fs/                # Cross-runtime file system operations
      sys/               # Cross-runtime process/system operations
    commands/            # CLI commands (convention-based: path = command name)
      all/               # Command implementations
        day/start.ts     # → sky day:start
        journal/new.ts   # → sky journal:new
        ai/chat/mod.ts   # → sky ai:chat
        services/mod.ts  # → sky services
      lib/               # Command runner infrastructure
    lib/                 # Application libraries
      services/          # launchctl service management
    service/             # GraphQL server + file watcher
    test/                # Test infrastructure
    tmpl/                # Templates for new documents
```

## Convention-Based Commands

The file path maps to the command name:

```
commands/all/day/start.ts       → sky day:start
commands/all/journal/new.ts     → sky journal:new
commands/all/ai/chat/mod.ts     → sky ai:chat
```

Commands export a class extending `Command` with a static `description` and a `run()` method returning `CommandResult`.

A command manifest (`~/.sky/sky.commands.json`) caches discovered commands for fast lookup and tab completion. Run `sky cli:commands --rebuild` to regenerate it after adding or removing commands.

## Development Commands

All commands run from `src/`:

```bash
bun run dev:fmt          # Format (oxfmt)
bun run dev:lint         # Lint (oxlint + banned-apis + tasks)
bun run dev:typecheck    # Type check (tsgo)
bun run dev:test:unit    # Run tests (bun test)
```

**All three checks (fmt, lint, typecheck) are mandatory after code changes.**

## Testing

- Runner: `bun test`
- Files: colocated with source, named `*_test.ts`
- Assertions: riteway-style `assert({ given, should, actual, expected })`
- Run specific tests: `bun test path/to/file_test.ts`
- Run all unit tests: `bun run dev:test:unit`

## Key Conventions

### Imports

Use subpath imports with `#` prefix (configured in `package.json`):

```typescript
import * as config from '#config'
import { readTextFile } from '#shared/fs/mod.ts'
import { runCommand } from '#lib/sys/mod.ts'
import { Command, CommandResult } from '#commands/mod.ts'
```

### Date/Time — NEVER use JS Date

Use `#universal/dates/nbdt/mod.ts` exclusively:

- `PlainDate` — dates without time (counting days, comparisons)
- `PlainDateTime` — date + time, no timezone (local events)
- `ZonedDateTime` — date + time + timezone (actual moments)
- `PlainDate.today()` — get today's date

**NEVER use `new Date()`, `Date` type, `.toISOString()`, or any JS Date APIs.** They silently mix local and UTC time, causing dates to shift by a day. When external libraries return JS `Date` objects, convert to nbdt types immediately at the boundary.

### File System Operations

```typescript
import { readTextFile, writeTextFile, exists, walk, readDir } from '#shared/fs/mod.ts'
// or
import { readFile, writeFile } from 'node:fs/promises'
```

### Process/System Operations

```typescript
import { env, exit } from '#shared/sys/mod.ts'
import { runCommand } from '#lib/sys/mod.ts'
```

### General Conventions

- **Date format**: YYYY-MM-DD everywhere
- **Markdown files**: YAML frontmatter for metadata
- **File organization**: Week-based directory structure under `time/` (see `nbfs` skill)
- **Configuration**: `~/.sky/config.jsonc` — user config (dir, editor, categories, AI models)
- **No direct runtime APIs**: Never use `Deno.*` APIs. All system operations go through `_shared-ts/` abstractions.

## Dependencies

Install with `bun add <package>` from `src/`. Always install the latest stable version — check with `npm view <package> version` first.

## Configuration

Sky reads from `~/.sky/config.jsonc`:

```jsonc
{
  "dir": "~/Sky",              // Notebook content directory
  "codeDir": "~/sky-oss",     // Sky code directory
  "editor": "code",            // Preferred editor
  "categories": ["Professional", "Personal"]
}
```

## Questions Are Questions, Not Requests

When the user asks a question, answer it. Do not write code.

- "Should we do X?" → Give your opinion. Do NOT implement X.
- "Why does this work this way?" → Explain. Do NOT refactor it.
- "What do you think about this approach?" → Discuss. Do NOT rewrite the code.

Only write code when explicitly asked: "do it", "yes", "go ahead", "build it".

## Code Quality

After modifying any TypeScript code, run all three checks from `src/`:

```bash
bun run dev:fmt        # Format
bun run dev:lint       # Lint
bun run dev:typecheck  # Type check
```

Fix any errors before proceeding. Run them after creating/editing TypeScript files and before committing.

## Git and Commits

- Never stage or commit files without explicit permission
- Always check `git diff --staged` before committing
- Commit message format: [Conventional Commits](https://www.conventionalcommits.org/) — `type(scope?): subject`
- Types: feat, fix, docs, style, refactor, perf, test, chore, revert, build, ci
- Examples:
  - `feat(journal): add weekly reflection summary`
  - `fix(service): prevent server starting on import`
  - `refactor(commands): move releases to sky-extras`
  - `docs(agents): add conventional commit examples`
  - `test(day): add recurring pattern matcher tests`
