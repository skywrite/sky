---
created: 2026-09-01
updated: 2026-10-20
---

# Recap commands

Design notes for `src/commands/all/recap/`.

Selecting and scheduling morning recap commands is described in the
[automation design](../../../../service/handler/automations/docs/README.md).

## Coding sessions — recap:claude-code and recap:codex

Both commands use `lib/recapCodingSessions.ts`: yesterday by default,
wake-to-wake attribution, one recap per app and day, optional AI session
digests, automatic tags/rel, and editor opening. `--dry-run` renders without
writing; `--no-ai` skips every AI step; `--no-editor` writes unattended.
`--model` selects the digest profile, with the same fast default for both.
Re-running replaces the recap while retaining curated tags and relations.

The source readers produce `CodingSession` records for the common renderer
and digest prompt. Counts and first/last activity spans describe engagement;
they do not estimate time worked. Failed digests retain the mechanical trail.

`recap:codex` reads `sessions/**/*.jsonl` and `archived_sessions/**/*.jsonl`
under `CODEX_HOME`, falling back to `~/.codex`. `--codex-dir` overrides that
home directory. The reader:

- Finds activity by each event's timestamp, including resumed sessions in
  older date folders. File modification time is only a pre-filter.
- Reads both older tool-call/result records and completed action records,
  including shell commands and file changes invoked through code mode.
- Counts typed prompts once across mirrored records; setup instructions,
  reasoning, token bookkeeping, subagents, and noninteractive `exec` runs
  do not count as user sessions. Archived copies deduplicate by session ID.
- Keeps the final answer, successful edits and commit subjects, and the
  command trail. A continuation can have activity without a new prompt.
- Streams logs and skips malformed/truncated records. No raw transcripts
  are copied into the repository.

The shared timing helpers use nbdt's `Instant` adapter for exact event times
and offset-aware comparisons. Notebook dates and extended-hour labels keep
their existing meaning, including `25:15` for next-calendar-day activity.

Narrative: [2026-09-06 — Codex rollout records](2026-09-06-codex-rollout-records.md).

## Finding the day's GitHub work — recap:github

`recap:github <day>` digests one notebook day's GitHub activity into a
recap doc under `actions/recaps/`. Its rules:

- **The day runs wake to wake.** The fetch starts twelve hours before the
  day's `started:` and ends at the next day's. A silence of three hours
  or more that resumes on a later calendar morning is read as sleep, and
  the activity is clamped to that span. `lib/dayWindow.ts` and
  `lib/wakeGap.ts` hold both rules.
- **Commits are found by when they were written, never by when they
  were pushed.** Two sources, folded by sha in `foldCommits`:

  | Source | Exact on time | Forks | Private repos | Cost |
  |---|---|---|---|---|
  | Commit search, `search/commits` by `author-date` and `committer-date` | yes | no | not relied on | 2 calls |
  | Pushed-repo sweep, `user/repos` by `pushed_at`, then each repo's commit listing | via `since`/`until` | yes | yes | 1 call per repo pushed since the window opened |

  Search sees every public repo the user ever touched. The sweep sees
  every repo the user is affiliated with, forks and private included.
  Each covers what the other misses.
- **The event feed is for PRs, reviews, and issues only.** GitHub's
  events API lags by hours and sometimes never catches up. Pushes in it
  are ignored.
- **A commit's instant is its authored time** when that falls inside the
  window, else its committed time (a rebase landing an older commit),
  else the commit is not the day's.
- **A source failing is a warning line, not a failed recap.** The other
  source still reports.

The pure fold, clamp, and render live in `lib/github.ts` and are tested
without GitHub. `lib/githubFetch.ts` holds every `gh` call.

Narrative: [2026-09-01 — commits found without the event feed](2026-09-01-github-commits-without-the-event-feed.md).

## Slack channels — recap:slack

`recap:slack <day>` digests one notebook day of every Slack channel the
owner is a member of into a recap under `actions/recaps/`, `app: slack`. It
is the room the owner was in, not his activity, and the day summary reads
it that way ([summary notes](../../summary/docs/README.md)). Its rules:

- **The day is the notebook's.** `lib/slackDay.ts` assembles it through the
  channel cache's day view ([pull notes](../../slack/pull/docs/README.md)):
  one document per channel, and for every thread replied to that day whose
  root sits on an earlier day, the root with the replies before the day.
  Replies after the day never ship.
- **A captured thread stays with its capture.** A thread the owner took
  part in is in the day directory; its captures carry the cache's anchor
  ids and a `link:` naming the message captured from, the root or a reply
  whose link carries the root's ts, which is how a thread captured over
  several days names its root on the later days. `dropCapturedThreads`
  leaves those threads to the capture, so the model reads one conversation
  once.
- **Opus 5.5 at high effort writes it**, under a 750k reading budget in the
  model's tokens, the fit and ratio the day summary uses; over budget it
  refuses rather than trims. The model writes the Channels block (one line
  per channel with its count, the quiet ones rolled up), What moved, Asked
  of you and Where things stand, every line tagged `[#channel HH:MM]` on
  the notebook clock. The title and counts line are the command's.
- **Once the next day has started.** The service runs `recap:slack
  --when-due` with its Slack passes: the newest of the last three days whose
  successor has a start stamp, that has channel messages and no recap yet.
  `summary:day` writes the recap first when a day with channel messages
  lacks one, so a batch of summaries never runs without Slack. The check
  does not know a cache rebuild is in progress: after one, re-run the days
  it may have recapped from half-written files.
- Re-running replaces the recap and keeps curated tags and rel, like every
  recap.

## Recaps tag and rel themselves

Every recap writer fills its empty `tags:` and `rel:` slots through
`lib/notebook/enrich/enrichRecap.ts`, the same auto-tag and auto-rel stack
the message, meeting, note, and chat captures use. The writers outside this
repo reach it as `@skywrite/core/recap`, together with
`lib/notebook/recap/readRecapCuration.ts`, which reads the slots back from
the day's existing file. Its rules:

- **Hand curation always wins.** A re-run keeps the file's existing
  `tags:` and `rel:`, and `--rel` is curation too. Enrichment fills only
  what is still empty. `--no-auto-tag` and `--no-auto-rel` close a slot;
  `--no-ai` on either coding recap closes both, since it promises no AI at all.
- **The app is the recap's conversation.** The corpus (`recap` medium in
  `lib/notebook/enrich/corpus.ts`, fed by the service's `recaps` query)
  keys each recap on its `app:`, so a GitHub recap's prior is what earlier
  GitHub recaps carried, and the tag menu is the closed set of tags already
  on recaps. A tag the archives never used cannot be proposed.
- **Rel comes from the body and the prior.** Subjects extracted from the
  recap body resolve against open projects and known entities; this app's
  earlier refs are candidates too. Selection keeps at most two.
- **Abstaining is fine.** A slot the classifiers cannot fill stays empty,
  exactly as before.

Narrative: [2026-09-01 — recaps tag and rel themselves](2026-09-01-recaps-tag-and-rel-themselves.md).
