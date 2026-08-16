import { runCommand } from '#lib/sys/command.ts'
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
 * Fold the user's event feed into per-repo activity. Pushes only mark the
 * repo as touched — commit details come from the per-repo listing, which
 * carries authored times (a batch push at 23:00 would otherwise collapse the
 * day's rhythm into one spike).
 */
export function collectFromEvents(events: GithubEvent[], window: ScanWindow): Map<string, GithubRepoActivity> {
  const repos = new Map<string, GithubRepoActivity>()

  const ensure = (repo: string): GithubRepoActivity => {
    let activity = repos.get(repo)
    if (!activity) {
      activity = { repo, commits: [], prs: [], reviews: [], issueEvents: 0, issueEventTimes: [] }
      repos.set(repo, activity)
    }
    return activity
  }

  for (const event of events) {
    if (!event.created_at || !event.repo?.name) continue
    const instant = new Date(event.created_at)
    if (Number.isNaN(instant.getTime())) continue
    if (instant < window.start || instant >= window.end) continue

    const repo = event.repo.name
    const payload = event.payload ?? {}

    switch (event.type) {
      case 'PushEvent':
        ensure(repo)
        break
      case 'PullRequestEvent': {
        const pr = payload.pull_request
        if (!pr?.number || payload.action === undefined) break
        if (payload.action !== 'opened' && payload.action !== 'closed') break
        ensure(repo).prs.push({
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
        ensure(repo).reviews.push({
          prNumber: pr.number,
          prTitle: pr.title ?? '',
          state: payload.review?.state ?? 'reviewed',
          instant,
        })
        break
      }
      case 'IssuesEvent':
      case 'IssueCommentEvent': {
        const activity = ensure(repo)
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

async function ghJsonLines<T>(args: string[]): Promise<T[]> {
  const result = await runCommand('gh', args)
  if (!result.success) {
    throw new Error(`gh ${args.slice(0, 2).join(' ')} failed: ${result.stderr.trim() || result.stdout.trim()}`)
  }
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((lineText) => JSON.parse(lineText) as T)
}

export async function fetchLogin(): Promise<string> {
  const result = await runCommand('gh', ['api', 'user', '--jq', '.login'])
  if (!result.success) {
    throw new Error(`gh api user failed — is gh authenticated? ${result.stderr.trim()}`)
  }
  return result.stdout.trim()
}

interface GithubCommitResponse {
  sha?: string
  commit?: {
    message?: string
    author?: { date?: string }
    committer?: { date?: string }
  }
}

/**
 * Pull the day's GitHub activity: the event feed for discovery (which repos,
 * PRs, reviews), then per-repo commit listings for authored times. A commit
 * whose authored time falls outside the window (a rebase) keeps its
 * committed time instead, so its clock stays inside the day it landed.
 */
export async function fetchGithubActivity(window: ScanWindow): Promise<GithubRepoActivity[]> {
  const login = await fetchLogin()
  const events = await ghJsonLines<GithubEvent>([
    'api',
    '--paginate',
    `users/${login}/events?per_page=100`,
    '--jq',
    '.[]',
  ])
  const repos = collectFromEvents(events, window)

  const since = window.start.toISOString()
  const until = window.end.toISOString()

  for (const activity of repos.values()) {
    let commits: GithubCommitResponse[]
    try {
      commits = await ghJsonLines<GithubCommitResponse>([
        'api',
        '--paginate',
        `repos/${activity.repo}/commits?author=${login}&since=${since}&until=${until}&per_page=100`,
        '--jq',
        '.[]',
      ])
    } catch {
      continue // repo listing can fail (deleted repo, missing scope) — keep the event-level activity
    }

    for (const response of commits) {
      if (!response.sha || !response.commit) continue
      const authored = response.commit.author?.date ? new Date(response.commit.author.date) : null
      const committed = response.commit.committer?.date ? new Date(response.commit.committer.date) : null
      const inWindow = (d: Date | null): d is Date => d !== null && d >= window.start && d < window.end
      const instant = inWindow(authored) ? authored : inWindow(committed) ? committed : null
      if (!instant) continue

      activity.commits.push({
        sha: response.sha,
        subject: (response.commit.message ?? '').split('\n')[0],
        instant,
      })
    }
    activity.commits.sort((a, b) => a.instant.getTime() - b.instant.getTime())
  }

  const active = [...repos.values()].filter(
    (a) => a.commits.length > 0 || a.prs.length > 0 || a.reviews.length > 0 || a.issueEvents > 0,
  )
  active.sort((a, b) => firstInstant(a) - firstInstant(b))
  return active
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
