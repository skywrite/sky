---
created: 2026-07-28
updated: 2026-08-29
---

# Commands

Sky ships 150+ commands. This is the tour — the ones worth knowing, grouped by what you're
trying to do. For the authoritative list:

```bash
sky cli:commands              # every command name
sky cli:commands --verbose    # with descriptions
sky <command> --help          # arguments and flags for one command
```

Command names map directly to file paths in the repo: `sky day:start` is
`src/commands/all/day/start.ts`. There is no registry — see
[Architecture](architecture.md).

## Running your day

```bash
sky day:start                    # open the day: create the file, pull recurring/scheduled
                                 #   items, stamp streaks, fetch weather and location
sky day:end                      # close the day: record duration, sweep incomplete work
sky day:open                     # open today's day file in your editor
sky day:todo:add "Ship Atlas v1" # add a todo
sky day:todo:pull                # pull the next item off your Next list
sky day:todo:move-next           # push unfinished todos to tomorrow
sky day:commitments:move-next    # push unfinished commitments to tomorrow
sky day:reminders:add "Renew passport"
sky day:location                 # set location from the device, or a phone via QR code
sky day:not-ended                # find days you forgot to close
sky day:perfect:check            # did you actually do everything you said you would?
```

`day:start` and `day:end` are composites — they run a configurable list of other commands.
Defaults are `day:sr:update`, `prices:all:fetch`, `util:weather` on start and
`day:todo:incomplete` on end; change them under `commands.day` in your config. Anything in
that list that doesn't resolve is warned about and skipped, not fatal — which is why a
fresh install mentions `prices:all:fetch` once and moves on.

`day:commitments:incomplete` is the same sweep for the Commitments lists. Add it next to
`day:todo:incomplete` in that list to close out both at day's end.

`day:sr:update` is itself a composite of `day:recurring:update`, `day:schedule:update` and
`day:reminders:update` — the three that populate today from your recurring patterns,
scheduled items, and reminder lists.

## Journaling and reflection

```bash
sky journal:new                  # journal entry with AI questions generated for today
sky journal:me:update            # update your About Me profile
sky journal:me:bio               # print the bio (used for prompt injection)
sky summary:day                  # what got done, what didn't
sky summary:week                 # momentum and opportunities
sky day:wisdom                   # an AI-generated quote for the day
```

`journal:me:update` is the highest-leverage command in Sky and the easiest to skip. The
About Me profile is what turns generic coaching questions into ones about *your* goals,
*your* people, and what you said last week. Do it before you decide whether the journaling
is any good.

## Habit streaks

```bash
sky streaks:new                  # define a habit, with AI-assisted clarification
sky streaks:done                 # strike today's item
sky streaks:list                 # current run, best run, month consistency
sky streaks:archive              # retire a habit, keeping its history
```

Streak definitions live in `streaks/active/` and `streaks/archived/`. The tracking itself
is the `## Streaks` list in each day file — struck items are the record, so your streak
history is just your day files, and it survives Sky.

## Capturing what happened

```bash
sky meeting:new                  # meeting notes
sky message:new                  # a message or communication
sky notes:new                    # a standalone note
sky event:new                    # an event
sky video:new                    # a video entry
sky mi:new                       # a Most Important item
```

Each of these files itself under today's `actions/` directory and adds the linking entry to
the day file's Complete list in the same step. That's what keeps the day file a truthful
index without you maintaining one.

## People, orgs, places, projects

```bash
sky person:new "Jane Doe"        # add someone to your CRM
sky person:list:last             # who you added recently
sky org:new "Acme Corp"          # add an org — enriches from Wikipedia and its website
sky org:new --site=acme.com      # same, but the name is detected from the site
sky org:webfetch                 # re-fetch and analyze an org's website
sky places:search                # search for a place and add it
sky places:new                   # add a place from a Maps link or coordinates
sky projects:new                 # start a project
sky projects:list                # list projects
sky projects:close               # close one out
```

## Decisions, goals, ideas

```bash
sky decisions:new                # AI-guided interview to record a decision
sky decisions:resolve            # record how it turned out
sky decisions:list               # review the register
sky decisions:export             # export one as a PDF
sky goals:review                 # review and update goals
sky ideas:new                    # capture an idea, AI-clarified
sky ideas:list                   # review them
```

Decisions are recorded with their reasoning at the time, then resolved later with the
outcome. Reading a year of resolved decisions is the single most useful thing in the
notebook for calibrating your own judgment.

## AI over your notebook

```bash
sky ai:chat                      # conversational AI with full notebook context
sky ai:chat --resume             # continue a saved conversation
sky ai:context:gather "What did I promise Jane last week?"
sky ai:profiles                  # list configured model profiles
sky ai:chat:tools                # what tools chat can call
```

`ai:chat` is the reason the file conventions are worth following. It generates GraphQL
queries against your notebook, gathers what's relevant, and answers from your actual
history rather than from a summary of it. Conversations are saved to
`actions/ai-chats/` in the day directory, so a chat is itself a notebook document —
including `tags:` and `rel:` frontmatter, chosen automatically on save from how past
chats were filed (hand-written values always win).

## Search and querying

```bash
sky markdown:sel "recent decisions about hiring"   # query by selector or GraphQL
sky markdown:filter                                # filter by tags, rel, glob, or day
sky markdown:concat                                # concatenate matching files
sky markdown:pdf                                   # render a file to a styled PDF
sky tags:list:all                                  # every tag in the notebook
sky tags:match                                     # find files by tag pattern
sky tags:rename                                    # rename a tag everywhere
```

## Communications

```bash
sky slack:new --from-link <url>  # import a Slack conversation as a message document
sky slack:unread                 # unread across channels and DMs
sky slack:follow:new             # track a thread until it resolves
sky slack:follow:check           # poll tracked threads for new activity
sky slack:auth                   # check and repair agent-slack credentials
sky slack:draft:list             # drafts waiting in Slack, most recently edited first
sky slack:draft:clear            # delete every draft (scheduled sends are kept)
sky slack:draft:reply <link> "…" # draft a thread reply in Slack, never sent
sky slack:draft:new <conv> "…"   # draft a message in a DM or channel composer, never sent
sky email:inbox:fetch            # download unsaved email into day files
sky email:inbox:follow:sync      # create follows for new threads, fetch new messages
sky telegram:inbox:fetch         # poll a Telegram bot for messages and photos
```

Follows are the accountability half of communication: a thread you're waiting on gets a
follow file, and `follow:check` tells you which ones have gone quiet.

Slack commands need either a Slack API token or the `agent-slack` CLI, plus
`slack.workspace` in your config. `sky init` detects and fills that in if `agent-slack` is
already installed.

## Media

```bash
sky audio:transcript:create      # transcribe an audio file
sky audio:transcript:clean       # fix transcription errors with AI-assisted Q&A
sky audio:transcript:summary     # structured summary of a transcript
sky summary:doc                  # summarize a PDF, image, Office or Apple document
```

## System and maintenance

```bash
sky init                         # initialize a notebook
sky services                     # list, start, stop background services
sky service:start                # run the GraphQL server + file watcher in the foreground
sky cli:commands --rebuild       # rebuild the command manifest after adding commands
sky secrets:set / :get / :list   # secrets in the OS keychain
sky nbfs:migrate                 # migrate an older notebook layout (dry-run by default)
sky util:now                     # current notebook time
sky util:tz:convert "3pm ET in Tokyo"
sky util:weather                 # record weather at your location
sky util:desktop:sweep           # move desktop files into the day's attachments folder
sky markdown:orphans             # files on disk the index doesn't know about
sky day:attachments:check        # attachments nothing references anymore
sky test:hello                   # verify the runner boots
```

## Adding your own

You don't have to fork Sky to extend it. Point `commands.dirs` in `~/.sky/config.jsonc` at
your own directory, drop a command file in it, and it gets discovered, named and
tab-completed like any built-in:

```jsonc
"commands": {
  "dirs": ["~/sky-extras"]
}
```

Run `sky cli:commands --rebuild` afterward so the manifest picks it up. The command file
format is in [Architecture → Anatomy of a command](architecture.md#anatomy-of-a-command).
