# Sky

**A plaintext, markdown-first personal operating system for continuous self-improvement.**

Sky is a CLI and file system for organizing your life — daily journaling, task management, personal CRM, goal tracking, and AI-powered reflection. Everything is a markdown file with YAML frontmatter. No database, no lock-in. Works with any editor.

## The Core Loop

```
Self-reflection → Learning → Action → Accountability
```

1. **Self-reflection** — Daily journaling with AI-generated questions that adapt to your day (weekday vs weekend, start of month, etc.)
2. **Learning** — Extract insights and lessons from experience
3. **Action** — Translate reflections into concrete tasks and commitments
4. **Accountability** — Track progress and hold yourself to commitments

The system compounds small daily improvements into transformational outcomes.

## Quick Start

```bash
# Install
npm i -g sky

# Initialize your notebook
sky init

# Start your first day
sky day:start

# Write a journal entry
sky journal:new

# Start an AI chat with full notebook context
sky ai:chat
```

## How It Works

### Everything is a markdown file

Sky stores all your data as plaintext markdown files with YAML frontmatter:

```markdown
---
who: Alice Smith, Bob Chen
when: 10:00 - 10:45
medium: Zoom
summary: Product sync — Q2 roadmap discussion
created: 2026-03-31
rel:
  - Acme Corp
tags: Product/Roadmap
---

# Product sync — Q2 roadmap discussion

Discussed the roadmap for Q2...
```

No proprietary format. No lock-in. Your data is readable with `cat`, searchable with `grep`, editable with any text editor, and version-controllable with git.

### The day file

Your day revolves around a single markdown file that Sky manages:

```
~/Sky/time/2026/03/30-05/31/day.md
```

It contains your tasks, completed items, and notes for the day:

```markdown
---
started: 08:30
ended:
location: places/US/TX/Austin
tz: America/Chicago
---

# **2026-03-31 - Tue**

## Professional Commitments
-

## Professional Todos
- Ship the v1 release
- Review PR from Alice

## Personal Todos
- Pick up groceries
- Call mom

## Professional Complete
- ~~09:30 > Standup with team~~
- ~~11:00 > Deploy staging build~~
```

### Day boundaries follow sleep, not midnight

A day starts with `sky day:start` and ends with `sky day:end`. If you're working at 1:30 AM, that's still part of today — Sky uses extended hours (`25:30`) to keep late-night work grouped with the logical day. The system tracks which day is "active", not what the clock says.

### Week-based file system (NBFS)

Files are organized by year, month, and week. Weeks run Monday through Sunday, named by first and last day numbers:

```
~/Sky/
  time/
    2026/
      03/
        30-05/                    # Week: Mon Mar 30 – Sun Apr 5
          30/                     # Monday
            day.md
          31/                     # Tuesday
            day.md
            actions/
              meetings/
                Zoom_JP-Alice_Product-Sync.md
              messages/
                slack_Bob_Q2-Planning-Thread.md
            journal/
              01_gratitude_Grateful-For-Team-Progress.md
          x01/                    # x prefix = next month (April) in March week
            day.md
          x02/
            day.md
  decisions/
  goals/
  heartbeat/
  ideas/
  notes/
  orgs/
  people/
  places/
  projects/
```

Dates use ISO 8601 (`YYYY-MM-DD`) everywhere — sorts lexicographically, is unambiguous, and works globally.

## CLI Commands

Sky has 170+ commands organized by category. Run `sky cli:commands --verbose` to see them all.

**Day management:**
```bash
sky day:start                    # Start your day (creates day file, fetches weather/location)
sky day:end                      # End your day (moves incomplete tasks)
sky day:todo:add "Ship v1"       # Add a task
sky day:todo:pull                # Pull next task from your backlog
sky day:open                     # Open today's day file in your editor
```

**Journaling:**
```bash
sky journal:new                  # Create a journal entry with AI-generated questions
sky journal:me:update            # Update your about-me profile (powers AI personalization)
```

**Communication tracking:**
```bash
sky meeting:new                  # Create meeting notes
sky slack:new --from-link <url>  # Import a Slack conversation
sky message:new                  # Create a message entry
```

**AI integration:**
```bash
sky ai:chat                      # Conversational AI with full notebook context
sky summary:day                  # AI summary of your day
sky summary:week                 # AI summary of your week
```

**Search and context:**
```bash
sky markdown:sel "recent decisions about hiring"  # AI-powered semantic search
sky ai:context:gather "What did I discuss with Alice last week?"
```

**People and organizations:**
```bash
sky person:new "Alice Smith"     # Add a person to your CRM
sky org:new "Acme Corp"          # Add an organization (auto-fetches Wikipedia + web data)
```

## Configuration

Sky is configured via `~/.sky/config.jsonc`:

```jsonc
{
  // Config version
  "version": 1,

  // Where your notebook lives
  "dir": "~/Sky",

  // Operational data (attachments, state — not git-tracked)
  "userDataDir": "~/Sky-Data",

  // Preferred editor
  "editor": "code",

  // Life domains — become section headers in day files
  "categories": ["Professional", "Personal"],

  // AI model preferences
  "ai": {
    "models": {
      "strong": "anthropic/claude-sonnet-4-20250514",
      "fast": "openai/gpt-4o-mini",
      "transcription": "openai/gpt-4o-transcribe"
    }
  }
}
```

Environment variables (`SKY_DIR`, `SKY_CODE_DIR`) override config file values.

API keys go in `notebook/.env` (never in config):

```bash
ANTHROPIC_API_KEY=sk-...
OPENAI_API_KEY=sk-...
```

## Architecture

```
sky/
  notebook/              # Core application (TypeScript, runs on Bun)
    _shared-ts/          # Shared models, parsers, utilities
    commands/            # CLI commands (convention-based: path = name)
      all/
        day/start.ts     # → sky day:start
        journal/new.ts   # → sky journal:new
        ai/chat/mod.ts   # → sky ai:chat
    service/             # GraphQL server + file watcher
    test/                # Test infrastructure
  bin/                   # Shell scripts (sky CLI entry point)
  extensions/            # Editor extensions
    vscode/              # VSCode completions for people, projects, tags
```

### Convention-based commands

The file path IS the command name. No registry to maintain:

```
commands/all/day/start.ts       → sky day:start
commands/all/journal/new.ts     → sky journal:new
commands/all/ai/chat/mod.ts     → sky ai:chat
```

Create a file, it becomes a command.

### Command anatomy

```typescript
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  name: Arg.string('Name of the item'),
  verbose: Flag.boolean('Show details', { short: 'v', default: false }),
}

type Params = InferParams<typeof params>

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

### Dev toolchain

| Tool | Purpose |
|------|---------|
| [Bun](https://bun.sh) | Runtime, package manager, test runner |
| [oxfmt](https://oxc.rs) | Code formatting (Rust, 178ms for 1000+ files) |
| [oxlint](https://oxc.rs) | Linting (Rust, ESLint-compatible) |
| [tsgo](https://github.com/nicklockwood/tsgo) | Type checking (Go port of tsc, native binary) |

```bash
bun run dev:fmt          # Format
bun run dev:lint         # Lint
bun run dev:typecheck    # Type check
bun run dev:test:unit    # Run tests (2400+ tests)
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[Apache 2.0](LICENSE)
