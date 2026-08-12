# Sky

**Your life in plaintext — and an AI that has actually read it.**

Sky is a CLI and a file convention for running your life out of markdown: daily journaling,
tasks, a personal CRM, decisions, goals, habit streaks. Every document is a plaintext file
with YAML frontmatter, sitting in a folder you own. No database. No app. No lock-in.

Every productivity tool eventually asks you to move your life into its database, then rents
it back to you. Sky inverts that. The notebook is just files; Sky is the CLI that keeps
them consistent. And the AI is good precisely *because* the data is open — it reads your
actual history, unmediated, instead of a summary some vendor decided to expose.

It's built around one loop:

```
Self-reflection → Learning → Action → Accountability
```

You reflect in the morning, the day file collects what actually happened, and the AI holds
you to what you said you'd do. Small daily deltas, compounded.

## A day in Sky

```bash
sky day:start                      # opens the day: pulls recurring work, stamps streaks,
                                   #   records weather and location
sky journal:new                    # AI asks questions about *your* day — not a template
sky day:todo:add "Ship Atlas v1"
sky meeting:new                    # files itself under today, links from the day file
sky streaks:done                   # strike today's habits
sky ai:chat                        # "what did I promise Jane last week, and did I do it?"
sky day:end                        # close out; unfinished work rolls forward
```

Every one of those wrote plain markdown into `~/Sky/`. Nothing is hidden, nothing is
encoded, and if Sky vanished tomorrow you'd still have every word.

## Install

Sky is **not on npm**. It runs from a clone on [Bun](https://bun.sh) — takes about five
minutes.

**Fastest path — hand it to a coding agent.** Paste this into Claude Code, Codex, or
anything else with shell access:

> Install Sky for me by following the instructions at
> `https://raw.githubusercontent.com/skywrite/sky/main/docs/INSTALL.md`

The install guide is written to be executed step-by-step, with a verification after each
one.

**Doing it yourself:** [docs/INSTALL.md](docs/INSTALL.md).

## Getting started

```bash
sky init                 # creates ~/Sky, ~/.sky/config.jsonc, and the notebook skeleton
sky journal:me:update    # tell Sky who you are — this is what makes the AI's output yours
sky day:start            # start your first day
sky journal:new          # write your first entry
sky ai:chat              # ask your notebook anything
```

Don't skip `journal:me:update`. It's the difference between generic coaching prompts and
questions about your actual goals and the actual people in your week.

Then spend ten minutes on [the overview](docs/overview.md) — after it, nothing Sky does
will be a mystery.

## Docs

| | |
|---|---|
| [Install](docs/INSTALL.md) | Setup, API keys, background service, troubleshooting |
| [Dependencies](docs/dependencies.md) | What Sky needs installed, required vs optional |
| [Overview](docs/overview.md) | How the notebook is laid out, and why |
| [Notebook time & NBFS](docs/nbfs.md) | The file layout and time model in depth |
| [Commands](docs/commands.md) | Tour of the 150+ commands |
| [Architecture](docs/architecture.md) | Code layout, and how to add a command |
| [Contributing](CONTRIBUTING.md) | PR guidelines |

## License

[Apache 2.0](LICENSE)
