import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import {
  type GithubEvent,
  type GithubRepoActivity,
  clampActivity,
  collectFromEvents,
  renderGithubRecap,
} from './github.ts'

const WINDOW = { start: new Date('2026-02-08T06:00:00Z'), end: new Date('2026-02-09T04:00:00Z') }

test('collectFromEvents folds the event feed into per-repo activity', () => {
  const events: GithubEvent[] = [
    { type: 'PushEvent', created_at: '2026-02-08T09:15:00Z', repo: { name: 'acme/atlas' } },
    {
      type: 'PullRequestEvent',
      created_at: '2026-02-08T14:02:00Z',
      repo: { name: 'acme/atlas' },
      payload: { action: 'opened', pull_request: { number: 12, title: 'Add widget' } },
    },
    {
      type: 'PullRequestEvent',
      created_at: '2026-02-08T18:30:00Z',
      repo: { name: 'acme/atlas' },
      payload: { action: 'closed', pull_request: { number: 11, title: 'Fix bug', merged: true } },
    },
    {
      type: 'PullRequestReviewEvent',
      created_at: '2026-02-08T16:10:00Z',
      repo: { name: 'acme/wallet' },
      payload: { pull_request: { number: 45, title: 'Refactor auth' }, review: { state: 'approved' } },
    },
    { type: 'IssueCommentEvent', created_at: '2026-02-08T11:00:00Z', repo: { name: 'acme/wallet' } },
    // Outside the window — dropped
    { type: 'PushEvent', created_at: '2026-02-07T09:00:00Z', repo: { name: 'acme/old' } },
    // Assignment-style PR actions are not opened/closed — dropped
    {
      type: 'PullRequestEvent',
      created_at: '2026-02-08T12:00:00Z',
      repo: { name: 'acme/atlas' },
      payload: { action: 'review_requested', pull_request: { number: 13, title: 'Other' } },
    },
  ]

  const repos = collectFromEvents(events, WINDOW)

  assert({
    given: 'events across two repos plus out-of-window noise',
    should: 'track exactly the two repos',
    expected: ['acme/atlas', 'acme/wallet'],
    actual: [...repos.keys()].sort(),
  })

  const atlas = repos.get('acme/atlas')

  assert({
    given: 'an opened and a merged PR',
    should: 'record both with their resolved actions',
    expected: ['opened', 'merged'],
    actual: atlas?.prs.map((pr) => pr.action),
  })

  const wallet = repos.get('acme/wallet')

  assert({
    given: 'a review event',
    should: 'record the review state',
    expected: 'approved',
    actual: wallet?.reviews[0]?.state,
  })

  assert({
    given: 'an issue comment',
    should: 'count it with its instant',
    expected: 1,
    actual: wallet?.issueEventTimes.length,
  })
})

test('renderGithubRecap renders repo sections with links and extended hours', () => {
  const repos: GithubRepoActivity[] = [
    {
      repo: 'acme/atlas',
      commits: [
        {
          sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
          subject: 'feat(widget): add the widget',
          instant: new Date('2026-02-08T09:15:00Z'),
        },
        {
          sha: 'ffeeddccbbaa99887766554433221100aabbccdd',
          subject: 'fix(widget): late-night fix',
          instant: new Date('2026-02-09T01:44:00Z'),
        },
      ],
      prs: [{ number: 12, title: 'Add widget', action: 'opened', instant: new Date('2026-02-08T14:02:00Z') }],
      reviews: [],
      issueEvents: 0,
      issueEventTimes: [],
    },
  ]

  const rendered = renderGithubRecap(repos, PlainDate.from('2026-02-08'), 'UTC')

  assert({
    given: 'two commits and one PR',
    should: 'render the summary line',
    expected: true,
    actual: rendered.body.includes('2 commits · 1 PR · 1 repo'),
  })

  assert({
    given: 'a commit',
    should: 'link its short sha to the commit page',
    expected: true,
    actual: rendered.body.includes(
      '([a1b2c3d](https://github.com/acme/atlas/commit/a1b2c3d4e5f60718293a4b5c6d7e8f9012345678))',
    ),
  })

  assert({
    given: 'a commit authored after midnight',
    should: 'render an extended-hours clock',
    expected: true,
    actual: rendered.body.includes('- 25:44 fix(widget): late-night fix'),
  })

  assert({
    given: 'the day span',
    should: 'run first commit to last commit',
    expected: '2026-02-08T09:15:00.000Z -> 2026-02-09T01:44:00.000Z',
    actual: `${rendered.first.toISOString()} -> ${rendered.last.toISOString()}`,
  })
})

test('clampActivity drops out-of-window work and empty repos', () => {
  const repos: GithubRepoActivity[] = [
    {
      repo: 'acme/atlas',
      commits: [
        { sha: 'aaaa111', subject: 'feat: before', instant: new Date('2026-02-09T01:00:00Z') },
        { sha: 'bbbb222', subject: 'feat: after wake', instant: new Date('2026-02-09T05:00:00Z') },
      ],
      prs: [],
      reviews: [],
      issueEvents: 0,
      issueEventTimes: [],
    },
    {
      repo: 'acme/wallet',
      commits: [{ sha: 'cccc333', subject: 'fix: morning only', instant: new Date('2026-02-09T05:30:00Z') }],
      prs: [],
      reviews: [],
      issueEvents: 0,
      issueEventTimes: [],
    },
  ]

  const clamped = clampActivity(repos, new Date('2026-02-08T06:00:00Z'), new Date('2026-02-09T01:20:00Z'))

  assert({
    given: 'a wake-to-wake window ending at 01:20',
    should: 'keep only in-window commits and drop the morning-only repo',
    expected: 'acme/atlas:aaaa111',
    actual: clamped.map((r) => `${r.repo}:${r.commits.map((c) => c.sha).join(',')}`).join(' '),
  })
})
