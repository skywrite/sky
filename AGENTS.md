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
| [tsc](https://www.typescriptlang.org) | Type checking (TypeScript 7, native Go binary) |

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
bun run dev:typecheck    # Type check (tsc)
bun run dev:test:unit    # Run tests (bun test)
```

**All three checks (fmt, lint, typecheck) are mandatory after code changes.**

## Testing

- Runner: `bun test`
- Files: colocated with source, named `*_test.ts`
- Assertions: riteway-style `assert({ given, should, actual, expected })`
- Run specific tests: `bun test path/to/file_test.ts`
- Run all unit tests: `bun run dev:test:unit`

## Never Hard-Code Real User Data — Use Mock Data

> ⛔ **HARD RULE — ZERO TOLERANCE. This repo is public. A leaked name pushed to GitHub cannot be unpublished.** This rule was violated once (2026-07-20: real project names from the notebook ended up in test fixtures and code comments, and required a full history rewrite). Never again.

Real user data is **anything observed while working — from ANY source**, not just what the user types in conversation:

- Data shared in conversation (names, addresses, coordinates, share/Maps links, emails, phone numbers, account IDs, API keys)
- **Anything seen while exploring the notebook** (`~/Sky` or wherever `dir` points): project names, folder names, people, orgs, file paths, file sizes, dates tied to real content
- Service/log output, GraphQL query results, command output containing notebook content

None of it may be baked into anything committed to the repo:

- Test fixtures, sample data, and expected values — **including fixture file paths** (`/projects/open/<RealName>/...` leaks just as hard as file contents)
- Command `usage` examples, flag descriptions, and `descriptionLong` text
- Code comments, doc examples, and templates (`tmpl/`)
- Commit messages

Substitute clearly fake / mock data instead — real personal data (e.g. someone's home coordinates or a link to their house) does not belong in source control. Good substitutes:

- Names → `"Jane Doe"`, `"Beach house"`, `"Joe's Cafe"`
- Project names → `"Atlas"`, `"Widget-V2"`, `"Team-Survey"`
- Coordinates → public landmarks (e.g. Eiffel Tower `48.85837, 2.294481`)
- Links / URLs → placeholders like `<google-maps-link>` or `https://example.com/...`
- Emails → `jane@example.com`

It's fine to use a real value transiently to **verify** behavior (run the command, resolve a link), but scrub it from every committed file afterward and delete any throwaway script that captured it.

**Mandatory before every commit:** grep the staged diff for every real name/value you encountered during the session (`git diff --staged | grep -i "<name>"`). If you explored the notebook at all, assume leakage until the grep proves otherwise.

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

**Adding a dep:** `bun add <package>` from `src/`. Always install the latest stable version — check with `npm view <package> version` first.

### This repo has multiple independent installs

There is no single install that sets up the whole repo. Each project has its own lockfile and its own (gitignored) `node_modules`:

| Project dir | Lockfile | Manager | Contents |
|---|---|---|---|
| `src/` | `bun.lock` | bun | **The real app (`sky`)** — all runtime deps, incl. the Vercel AI SDK (`ai`, `@ai-sdk/*`), `@anthropic-ai/sdk`, `openai`. **This is the install that matters.** |
| `./` (root) | `bun.lock` | bun | Thin `packages/*` workspace (`@skywrite/commands`, `@skywrite/core`) only — **no third-party deps**, so installing here is nearly a no-op. |

**Trap:** installing only at the repo root does NOT install the app — the app's deps live in `src/`. Always install from `src/`.

### Restoring deps (fresh checkout, or a machine move where `node_modules` didn't come along)

`node_modules/` is gitignored, so it never syncs (Tresorit/Dropbox) and a fresh checkout has none. Restore at the exact locked versions **without modifying any lockfile**:

```bash
cd src && bun install --frozen-lockfile      # ← the one that matters (app + AI SDK)
cd .. && bun install --frozen-lockfile       # root workspace (near-noop)
```

`bun install --frozen-lockfile` installs strictly from `bun.lock` and fails instead of rewriting it — it never modifies the lockfile. Note it still *installs missing* packages (it just won't *change versions*), so it's the right tool after a partial sync.

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
