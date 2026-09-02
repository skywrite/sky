---
status: shipped
created: 2026-09-01
updated: 2026-09-01
---

# GitHub commits are found without the event feed

## Symptom

`sky recap:github` for a day of steady commits answered "No GitHub
activity found". Every commit was on GitHub. The recap never asked for
them.

## Root cause

Two layers.

1. **Discovery was keyed on push time.** The recap took the repos to ask
   about from the user's event feed, keeping only push events dated
   inside the day's window. Commits written during the day and pushed
   after the next day started, the normal batch-push rhythm, leave no
   push inside the window, so their repo was never listed. Earlier
   recaps worked only when some other push happened to land inside the
   twelve-hour lookback.
2. **The feed itself was stale.** GitHub documents thirty seconds to six
   hours of latency on the events API. On the day reviewed its newest
   entry was over forty hours old, with five later pushes visible on
   GitHub and none in the feed, including the one the lookback would
   have caught.

## Change

Commits are discovered by when they were written, from two sources
folded by sha (the table in the README). The event feed keeps only PRs,
reviews, and issue activity. Each commit source degrades to a warning
line; the other still reports.

## Why two sources

Both were checked against live data before choosing:

- Commit search with a timestamped `author-date` range returned every
  commit of the reviewed day in one call. It returned nothing for a
  fork that held three of the user's commits from the same week: GitHub
  does not index forks for commit search.
- The pushed-repo sweep lists every repo the user is affiliated with
  whose `pushed_at` is at or after the window's start, then asks each
  for the user's commits in the window. That covers forks and private
  repos, but costs one call per repo pushed since the window opened,
  dozens in a busy organization, so the listings run six at a time. It
  only sees affiliated repos; a drive-by contribution to someone else's
  public repo is search's to find.

## Rejected alternatives

- **A longer lookback on the event feed.** Still keyed on push time,
  still stale.
- **Commit search alone.** Misses forks.
- **The sweep alone.** Misses drive-by public contributions, and every
  day pays the per-repo cost with nothing cheaper in front of it.
