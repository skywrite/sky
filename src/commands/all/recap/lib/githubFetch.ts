import mapLimit from '#commands/all/slack/lib/mapLimit.ts'
import { runCommand } from '#lib/sys/command.ts'
import type { ScanWindow } from './claudeCode.ts'
import {
  type DiscoveredCommit,
  type GithubEvent,
  type GithubRepoActivity,
  activeRepos,
  collectFromEvents,
  foldCommits,
} from './github.ts'

// Per-repo listings run side by side: the sweep can cover dozens of repos.
const LISTING_CONCURRENCY = 6

// Sanity bound on the pushed-repo sweep: ten pages of a hundred repos.
const MAX_REPO_PAGES = 10

export interface FetchOptions {
  /** Called when one commit source fails and the other carries on alone. */
  warn?: (message: string) => void
}

async function ghJsonLines<T>(args: string[]): Promise<T[]> {
  const result = await runCommand('gh', args)
  if (!result.success) {
    const endpoint = args.find((arg) => arg.includes('/')) ?? args.join(' ')
    throw new Error(`gh ${endpoint} failed: ${result.stderr.trim() || result.stdout.trim()}`)
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
  /** Search hits carry their repo; a per-repo listing already knows it. */
  repository?: { full_name?: string }
}

interface GithubRepoResponse {
  full_name?: string
  pushed_at?: string
}

function parseInstant(value?: string): Date | null {
  if (!value) return null
  const instant = new Date(value)
  return Number.isNaN(instant.getTime()) ? null : instant
}

function toDiscoveredCommit(repo: string, response: GithubCommitResponse): DiscoveredCommit | null {
  if (!response.sha || !response.commit) return null
  return {
    repo,
    sha: response.sha,
    message: response.commit.message ?? '',
    authored: parseInstant(response.commit.author?.date),
    committed: parseInstant(response.commit.committer?.date),
  }
}

/** Search date qualifiers take an ISO timestamp with an explicit offset. */
function searchInstant(instant: Date): string {
  return `${instant.toISOString().slice(0, 19)}+00:00`
}

/**
 * Commit search by the user's login over the window: exact on the time a
 * commit was written (and committed, so a rebase landing an older commit
 * is seen), across every public repo the user has touched. Search does
 * not index forks, so it cannot stand alone.
 */
export async function searchCommits(login: string, window: ScanWindow): Promise<DiscoveredCommit[]> {
  const range = `${searchInstant(window.start)}..${searchInstant(window.end)}`
  const found: DiscoveredCommit[] = []
  for (const qualifier of ['author-date', 'committer-date']) {
    const hits = await ghJsonLines<GithubCommitResponse>([
      'api',
      '-X',
      'GET',
      '--paginate',
      'search/commits',
      '-f',
      `q=author:${login} ${qualifier}:${range}`,
      '-f',
      'per_page=100',
      '--jq',
      '.items[]',
    ])
    for (const hit of hits) {
      const repo = hit.repository?.full_name
      const commit = repo ? toDiscoveredCommit(repo, hit) : null
      if (commit) found.push(commit)
    }
  }
  return found
}

/**
 * Every repo the user can reach that took a push since the window opened.
 * A commit written inside the window is pushed at some later time, so the
 * repo's pushed_at is the one signal that cannot miss it. The listing is
 * newest-push-first; paging stops once it runs past the window.
 */
export async function fetchReposPushedSince(since: Date): Promise<string[]> {
  const repos: string[] = []
  for (let page = 1; page <= MAX_REPO_PAGES; page++) {
    const batch = await ghJsonLines<GithubRepoResponse>([
      'api',
      `user/repos?sort=pushed&direction=desc&affiliation=owner,collaborator,organization_member&per_page=100&page=${page}`,
      '--jq',
      '.[]',
    ])
    let ranPast = false
    for (const repo of batch) {
      const pushed = parseInstant(repo.pushed_at)
      if (!repo.full_name || !pushed) continue
      if (pushed < since) {
        ranPast = true
        break
      }
      repos.push(repo.full_name)
    }
    if (ranPast || batch.length < 100) break
  }
  return repos
}

/** The user's commits on a repo's default branch inside the window. */
async function listRepoCommits(repo: string, login: string, window: ScanWindow): Promise<DiscoveredCommit[]> {
  const since = window.start.toISOString()
  const until = window.end.toISOString()
  let responses: GithubCommitResponse[]
  try {
    responses = await ghJsonLines<GithubCommitResponse>([
      'api',
      '--paginate',
      `repos/${repo}/commits?author=${login}&since=${since}&until=${until}&per_page=100`,
      '--jq',
      '.[]',
    ])
  } catch {
    return [] // a listing can fail (deleted repo, missing scope); search may still cover it
  }
  return responses.flatMap((response) => toDiscoveredCommit(repo, response) ?? [])
}

async function sweepPushedRepos(login: string, window: ScanWindow): Promise<DiscoveredCommit[]> {
  const repos = await fetchReposPushedSince(window.start)
  const listings = await mapLimit(repos, LISTING_CONCURRENCY, (repo) => listRepoCommits(repo, login, window))
  return listings.flat()
}

/**
 * Pull the day's GitHub activity.
 *
 * The event feed discovers PRs, reviews, and issue activity only. Commits
 * come from two sources folded by sha: commit search, exact on the time a
 * commit was written but blind to forks, and a sweep of every reachable
 * repo pushed since the window opened, listed per repo, which covers forks
 * and private repos at one call per repo. Each covers what the other
 * misses. A source failing is a warning, not a lost day.
 */
export async function fetchGithubActivity(
  window: ScanWindow,
  options: FetchOptions = {},
): Promise<GithubRepoActivity[]> {
  const warn = options.warn ?? (() => {})
  const login = await fetchLogin()
  const events = await ghJsonLines<GithubEvent>([
    'api',
    '--paginate',
    `users/${login}/events?per_page=100`,
    '--jq',
    '.[]',
  ])
  const repos = collectFromEvents(events, window)

  const [searched, swept] = await Promise.all([
    searchCommits(login, window).catch((err: Error): DiscoveredCommit[] => {
      warn(`Commit search failed; only the pushed-repo sweep found commits: ${err.message}`)
      return []
    }),
    sweepPushedRepos(login, window).catch((err: Error): DiscoveredCommit[] => {
      warn(`Pushed-repo sweep failed; only commit search found commits: ${err.message}`)
      return []
    }),
  ])
  foldCommits(repos, [...searched, ...swept], window)

  return activeRepos(repos)
}
