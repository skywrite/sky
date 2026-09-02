import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { RenderedRecap, ScanWindow } from './claudeCode.ts'
import { dayClock, dayLabel } from './clock.ts'

export interface GithubCommit {
  sha: string
  subject: string
  instant: Date
}

export interface GithubPullRequest {
  number: number
  title: string
  action: 'opened' | 'merged' | 'closed'
  instant: Date
}

export interface GithubReview {
  prNumber: number
  prTitle: string
  state: string
  instant: Date
}

export interface GithubRepoActivity {
  repo: string
  commits: GithubCommit[]
  prs: GithubPullRequest[]
  reviews: GithubReview[]
  issueEvents: number
  /** Instants of issue activity — kept so issue-only repos still have a span. */
  issueEventTimes: Date[]
}

export interface GithubEvent {
  type?: string
  created_at?: string
  repo?: { name?: string }
  payload?: {
    action?: string
    pull_request?: { number?: number; title?: string; merged?: boolean }
    review?: { state?: string }
  }
}

/**
 * A commit as a discovery source reports it, before the window rule picks
 * its instant. Search hits and per-repo listings both map here.
 */
export interface DiscoveredCommit {
  repo: string
  sha: string
  message: string
  authored: Date | null
  committed: Date | null
}

function ensureActivity(repos: Map<string, GithubRepoActivity>, repo: string): GithubRepoActivity {
  let activity = repos.get(repo)
  if (!activity) {
    activity = { repo, commits: [], prs: [], reviews: [], issueEvents: 0, issueEventTimes: [] }
    repos.set(repo, activity)
  }
  return activity
}

function hasActivity(activity: GithubRepoActivity): boolean {
  return (
    activity.commits.length > 0 || activity.prs.length > 0 || activity.reviews.length > 0 || activity.issueEvents > 0
  )
}

/**
 * Fold the user's event feed into per-repo activity: PRs, reviews, and
 * issue activity. Pushes are ignored. The feed lags GitHub by hours and
 * sometimes never catches up, and a push's time says nothing about when
 * its commits were written. Commits arrive through foldCommits instead.
 */
export function collectFromEvents(events: GithubEvent[], window: ScanWindow): Map<string, GithubRepoActivity> {
  const repos = new Map<string, GithubRepoActivity>()

  for (const event of events) {
    if (!event.created_at || !event.repo?.name) continue
    const instant = new Date(event.created_at)
    if (Number.isNaN(instant.getTime())) continue
    if (instant < window.start || instant >= window.end) continue

    const repo = event.repo.name
    const payload = event.payload ?? {}

    switch (event.type) {
      case 'PullRequestEvent': {
        const pr = payload.pull_request
        if (!pr?.number || payload.action === undefined) break
        if (payload.action !== 'opened' && payload.action !== 'closed') break
        ensureActivity(repos, repo).prs.push({
          number: pr.number,
          title: pr.title ?? '',
          action: payload.action === 'opened' ? 'opened' : pr.merged ? 'merged' : 'closed',
          instant,
        })
        break
      }
      case 'PullRequestReviewEvent': {
        const pr = payload.pull_request
        if (!pr?.number) break
        ensureActivity(repos, repo).reviews.push({
          prNumber: pr.number,
          prTitle: pr.title ?? '',
          state: payload.review?.state ?? 'reviewed',
          instant,
        })
        break
      }
      case 'IssuesEvent':
      case 'IssueCommentEvent': {
        const activity = ensureActivity(repos, repo)
        activity.issueEvents += 1
        activity.issueEventTimes.push(instant)
        break
      }
      default:
        break
    }
  }

  return repos
}

/**
 * Fold discovered commits into per-repo activity. Both sources can report
 * the same commit; the sha dedupes it. A commit's instant is its authored
 * time when that falls inside the window, else its committed time (a
 * rebase landing a commit written earlier), else it is not this window's.
 */
export function foldCommits(
  repos: Map<string, GithubRepoActivity>,
  commits: DiscoveredCommit[],
  window: ScanWindow,
): void {
  const inWindow = (d: Date | null): d is Date => d !== null && d >= window.start && d < window.end
  const seen = new Set<string>()

  for (const found of commits) {
    const instant = inWindow(found.authored) ? found.authored : inWindow(found.committed) ? found.committed : null
    if (!instant) continue
    const key = `${found.repo} ${found.sha}`
    if (seen.has(key)) continue
    seen.add(key)
    ensureActivity(repos, found.repo).commits.push({
      sha: found.sha,
      subject: found.message.split('\n')[0],
      instant,
    })
  }

  for (const activity of repos.values()) {
    activity.commits.sort((a, b) => a.instant.getTime() - b.instant.getTime())
  }
}

/** Repos with something in them, earliest activity first. */
export function activeRepos(repos: Map<string, GithubRepoActivity>): GithubRepoActivity[] {
  const active = [...repos.values()].filter(hasActivity)
  active.sort((a, b) => firstInstant(a) - firstInstant(b))
  return active
}

/** Every authored instant in the day's activity, sorted — the presence signal. */
export function activityInstants(repos: GithubRepoActivity[]): Date[] {
  return repos
    .flatMap((r) => [
      ...r.commits.map((c) => c.instant),
      ...r.prs.map((p) => p.instant),
      ...r.reviews.map((v) => v.instant),
      ...r.issueEventTimes,
    ])
    .sort((a, b) => a.getTime() - b.getTime())
}

/** Keep only activity inside the wake-to-wake window; empty repos drop entirely. */
export function clampActivity(repos: GithubRepoActivity[], start: Date, end: Date): GithubRepoActivity[] {
  const keep = (instant: Date) => instant >= start && instant <= end
  return repos
    .map((r) => {
      const issueEventTimes = r.issueEventTimes.filter(keep)
      return {
        ...r,
        commits: r.commits.filter((c) => keep(c.instant)),
        prs: r.prs.filter((p) => keep(p.instant)),
        reviews: r.reviews.filter((v) => keep(v.instant)),
        issueEventTimes,
        issueEvents: issueEventTimes.length,
      }
    })
    .filter(hasActivity)
}

function firstInstant(activity: GithubRepoActivity): number {
  const instants = [
    ...activity.commits.map((c) => c.instant.getTime()),
    ...activity.prs.map((p) => p.instant.getTime()),
    ...activity.reviews.map((r) => r.instant.getTime()),
    ...activity.issueEventTimes.map((d) => d.getTime()),
  ]
  return instants.length ? Math.min(...instants) : Number.MAX_SAFE_INTEGER
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function repoHeading(activity: GithubRepoActivity): string {
  const parts: string[] = []
  if (activity.commits.length) parts.push(plural(activity.commits.length, 'commit'))
  if (activity.prs.length) parts.push(plural(activity.prs.length, 'PR'))
  if (activity.reviews.length) parts.push(plural(activity.reviews.length, 'review'))
  return parts.length ? `## ${activity.repo} (${parts.join(', ')})` : `## ${activity.repo}`
}

/** Render per-repo GitHub activity as the recap body, linking back to the substance. */
export function renderGithubRecap(repos: GithubRepoActivity[], day: PlainDate, timezone: string): RenderedRecap {
  const totalCommits = repos.reduce((sum, r) => sum + r.commits.length, 0)
  const totalPrs = repos.reduce((sum, r) => sum + r.prs.length, 0)
  const totalReviews = repos.reduce((sum, r) => sum + r.reviews.length, 0)

  const instants: Date[] = repos.flatMap((r) => [
    ...r.commits.map((c) => c.instant),
    ...r.prs.map((p) => p.instant),
    ...r.reviews.map((v) => v.instant),
    ...r.issueEventTimes,
  ])
  const first = instants.reduce((min, d) => (d < min ? d : min), instants[0])
  const last = instants.reduce((max, d) => (d > max ? d : max), instants[0])

  const summary: string[] = []
  if (totalCommits) summary.push(plural(totalCommits, 'commit'))
  if (totalPrs) summary.push(plural(totalPrs, 'PR'))
  if (totalReviews) summary.push(plural(totalReviews, 'review'))
  summary.push(plural(repos.length, 'repo'))

  const lines: string[] = []
  lines.push(`# GitHub — ${dayLabel(day)}`)
  lines.push('')
  lines.push(summary.join(' · '))

  for (const activity of repos) {
    lines.push('')
    lines.push(repoHeading(activity))
    lines.push('')
    for (const commit of activity.commits) {
      const clock = dayClock(commit.instant, day, timezone)
      const short = commit.sha.slice(0, 7)
      lines.push(`- ${clock} ${commit.subject} ([${short}](https://github.com/${activity.repo}/commit/${commit.sha}))`)
    }
    for (const pr of activity.prs) {
      const clock = dayClock(pr.instant, day, timezone)
      const verb = pr.action === 'opened' ? 'Opened' : pr.action === 'merged' ? 'Merged' : 'Closed'
      lines.push(
        `- ${clock} ${verb} [#${pr.number}](https://github.com/${activity.repo}/pull/${pr.number}) — ${pr.title}`,
      )
    }
    for (const review of activity.reviews) {
      const clock = dayClock(review.instant, day, timezone)
      lines.push(
        `- ${clock} Reviewed [#${review.prNumber}](https://github.com/${activity.repo}/pull/${review.prNumber}) — ${review.prTitle} (${review.state.toLowerCase()})`,
      )
    }
    if (activity.issueEvents > 0) {
      lines.push(`- ${plural(activity.issueEvents, 'issue interaction')}`)
    }
  }

  lines.push('')
  return { body: lines.join('\n'), first, last }
}
