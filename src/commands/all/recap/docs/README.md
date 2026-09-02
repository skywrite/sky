---
created: 2026-09-01
updated: 2026-09-01
---

# Recap commands

Design notes for `src/commands/all/recap/`. The GitHub recap's discovery
model is written up so far. Extend this file as other parts of the group
need a mental model.

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
