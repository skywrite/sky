import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import type { WorkstreamReview } from './ai.ts'
import { runWorkstream, scanWorkstreams } from './runner.ts'
import { WorkstreamStore } from './store.ts'
import { ActivitySchema, ReportingSchema, SkySchema, type WorkstreamRecord } from './types.ts'

const NOW = '2025-03-15 09:00'
const review = (changes: Partial<WorkstreamReview> = {}): WorkstreamReview => ({
  summary: 'Prepared a first approach; the scope decision remains with the owner.',
  understanding: 'The pilot scope still needs confirmation.',
  unknowns: ['The agreed pilot scope.'],
  outcomeSuggestion: '',
  activities: [],
  decisions: [],
  relationships: [],
  suggestions: [],
  subworkstreams: [],
  artifact: null,
  communication: null,
  waitingFor: 'Owner confirmation of scope.',
  nextCheckMinutes: 1440,
  ...changes,
})

async function fixture(
  run: (store: WorkstreamStore, work: WorkstreamRecord, root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-workstreams-run-'))
  const content = path.join(root, 'state', 'content')
  const store = new WorkstreamStore(
    path.join(content, 'workstreams'),
    path.join(root, 'state'),
    root,
    undefined,
    content,
  )
  try {
    const work = await store.create({ title: 'Atlas pilot', outcome: 'Complete a useful pilot.' }, NOW)
    await run(store, work, root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function current(store: WorkstreamStore, id: string): Promise<WorkstreamRecord> {
  const work = await store.get(id)
  if (!work) throw new Error('Fixture workstream missing')
  return work
}

async function enable(store: WorkstreamStore, work: WorkstreamRecord, settings = {}): Promise<WorkstreamRecord> {
  return store.configureSky(work.id, SkySchema.parse({ mode: 'assist', ...settings }), work.revision)
}

test('manual assistance prepares real local work without creating standing authority', async () => {
  await fixture(async (store, work) => {
    const result = await runWorkstream({
      store,
      id: work.id,
      now: NOW,
      propose: async () =>
        review({
          artifact: { title: 'Pilot outline', body: 'A first draft with scope still to confirm.', activityId: '' },
        }),
    })
    const saved = await current(store, work.id)
    const artifact = await store.readArtifact(work.id, result.artifactIds[0])
    const subsequent = await runWorkstream({
      store,
      id: work.id,
      now: '2025-03-15T09:05',
      trigger: 'scheduled',
      propose: async () => {
        throw new Error('No standing grant')
      },
    })
    assert({
      given: 'one manual request on a human-driven workstream',
      should: 'persist a draft and actual run while leaving future execution off',
      actual: [
        result.status,
        saved.artifacts.length,
        artifact.content.includes('scope still to confirm'),
        (await store.getGrant(work.id)).mode,
        subsequent.status,
      ],
      expected: ['completed', 1, true, 'off', 'nothing'],
    })
  })
})

test('runner reads linked workstream content from state alongside ordinary notebook sources', async () => {
  await fixture(async (store, initial, root) => {
    await writeFile(path.join(root, 'source.md'), 'Notebook evidence for the pilot.')
    const peer = await store.create({ title: 'Pilot scope', notes: 'The scope is confirmed.' }, NOW)
    const work = await store.put(
      {
        ...initial,
        sources: [
          { id: 'note', path: 'source.md', label: 'Pilot note', sensitive: false },
          { id: 'scope', path: peer.path, label: 'Pilot scope', sensitive: false },
        ],
      },
      initial.revision,
    )
    let received: { id: string; content: string; error?: string }[] = []
    const result = await runWorkstream({
      store,
      id: work.id,
      now: NOW,
      propose: async (context) => {
        received = context.sources as typeof received
        return review()
      },
    })
    assert({
      given: 'a source in the notebook and a linked workstream in separate state content',
      should: 'supply both actual sources to Sky without treating the moved work as missing',
      actual: [
        result.status,
        received.map((source) => [
          source.id,
          Boolean(source.error),
          source.content.includes(source.id === 'note' ? 'Notebook evidence' : 'scope is confirmed'),
        ]),
      ],
      expected: [
        'completed',
        [
          ['note', false, true],
          ['scope', false, true],
        ],
      ],
    })
  })
})

test('Sky retains exact relationship meaning and prerequisite activity identities for review', async () => {
  await fixture(async (store, initial) => {
    const target = await store.create(
      { title: 'Atlas scope', activities: [ActivitySchema.parse({ id: 'approve', title: 'Approve scope' })] },
      NOW,
    )
    const work = await store.put(
      { ...initial, activities: [ActivitySchema.parse({ id: 'launch', title: 'Start pilot' })] },
      initial.revision,
    )
    const run = await runWorkstream({
      store,
      id: work.id,
      now: NOW,
      propose: async () =>
        review({
          relationships: [
            { workstreamId: target.id, kind: 'contributes', reason: 'Supports the pilot outcome.' },
            {
              workstreamId: target.id,
              kind: 'prerequisite',
              reason: 'Scope is required before the pilot starts.',
              activityId: 'launch',
              requiredActivityId: 'approve',
              requiredResult: 'The pilot scope is approved.',
            },
          ],
        }),
    })
    const saved = await current(store, work.id)
    assert({
      given: 'Sky proposes contribution and one precise prerequisite without authority to apply either',
      should: 'preserve the review metadata and leave accepted work and eligibility unchanged',
      actual: [
        run.status,
        saved.proposals.map(({ relationKind, targetId, activityId, requiredActivityId, requiredResult }) => ({
          relationKind,
          targetId,
          activityId,
          requiredActivityId,
          requiredResult,
        })),
        saved.relations.length,
        saved.activities[0].requires.length,
      ],
      expected: [
        'completed',
        [
          {
            relationKind: 'contributes',
            targetId: target.id,
            activityId: undefined,
            requiredActivityId: undefined,
            requiredResult: undefined,
          },
          {
            relationKind: 'prerequisite',
            targetId: target.id,
            activityId: 'launch',
            requiredActivityId: 'approve',
            requiredResult: 'The pilot scope is approved.',
          },
        ],
        0,
        0,
      ],
    })
  })
})

test('incoming contributions wake Sky when their recorded timing or results change', async () => {
  await fixture(async (store, initial) => {
    const target = await enable(store, initial)
    let contributor = await store.create(
      {
        title: 'Atlas support',
        due: '2025-03-20',
        relations: [{ targetId: target.id, kind: 'contributes', reason: 'Prepares support for the pilot.' }],
        activities: [ActivitySchema.parse({ id: 'support', title: 'Prepare support' })],
      },
      NOW,
    )
    const contexts: unknown[] = []
    const propose = async (context: Record<string, unknown>) => {
      contexts.push(context.relatedWork)
      return review({ waitingFor: '' })
    }
    const first = await runWorkstream({ store, id: target.id, now: NOW, trigger: 'scheduled', propose })
    const unchanged = await runWorkstream({
      store,
      id: target.id,
      now: '2025-03-15T09:05',
      trigger: 'scheduled',
      propose,
    })
    contributor = await store.put(
      {
        ...contributor,
        due: '2025-03-24',
        activities: contributor.activities.map((activity) => ({
          ...activity,
          state: 'done',
          result: 'Support outline is ready.',
        })),
      },
      contributor.revision,
    )
    const changed = await runWorkstream({
      store,
      id: target.id,
      now: '2025-03-15T09:10',
      trigger: 'scheduled',
      propose,
    })
    const related = (
      contexts[1] as { id: string; due: string; relations: unknown[]; activities: { result: string }[] }[]
    )[0]
    assert({
      given: 'another workstream contributes to this outcome and then changes its timing and result',
      should: 'observe incoming work, skip unchanged scans, and review the recorded change before the normal cadence',
      actual: [
        first.status,
        unchanged.status,
        changed.status,
        contexts.length,
        related.id,
        related.due,
        related.relations,
        related.activities[0].result,
      ],
      expected: [
        'completed',
        'nothing',
        'completed',
        2,
        contributor.id,
        '2025-03-24',
        contributor.relations,
        'Support outline is ready.',
      ],
    })
  })
})

test('scheduled reviews coalesce their own writes but wake when selected context changes', async () => {
  await fixture(async (store, initial, root) => {
    await writeFile(path.join(root, 'source.md'), 'The pilot has one open scope question.')
    const work = await enable(
      store,
      await store.put(
        { ...initial, sources: [{ id: 'source', path: 'source.md', label: 'Pilot discussion', sensitive: false }] },
        initial.revision,
      ),
    )
    let calls = 0
    const propose = async () => {
      calls++
      return review({ artifact: { title: 'Scope draft', body: 'Scope remains provisional.', activityId: '' } })
    }
    const first = await runWorkstream({ store, id: work.id, now: NOW, trigger: 'scheduled', propose })
    const second = await runWorkstream({ store, id: work.id, now: '2025-03-15T09:05', trigger: 'scheduled', propose })
    await writeFile(path.join(root, 'source.md'), 'The owner approved the pilot scope.')
    const third = await runWorkstream({ store, id: work.id, now: '2025-03-15T09:10', trigger: 'scheduled', propose })
    assert({
      given: 'unchanged context followed by a new saved result',
      should: 'skip self-generated writes and review the new source once',
      actual: [first.status, second.status, third.status, calls],
      expected: ['completed', 'nothing', 'completed', 2],
    })
  })
})

test('human edits and authority revocation discard a model proposal before any local artifact', async () => {
  await fixture(async (store, initial) => {
    const work = await enable(store, initial)
    const result = await runWorkstream({
      store,
      id: work.id,
      now: NOW,
      propose: async () => {
        const fresh = await current(store, work.id)
        await store.configureSky(work.id, SkySchema.parse({ mode: 'off' }), fresh.revision)
        return review({ artifact: { title: 'Obsolete draft', body: 'Must not be written.', activityId: '' } })
      },
    })
    assert({
      given: 'the owner revokes responsibility while Sky is thinking',
      should: 'retain the revocation and discard obsolete work',
      actual: [result.status, (await current(store, work.id)).artifacts.length, (await store.getGrant(work.id)).mode],
      expected: ['failed', 0, 'off'],
    })
  })
})

test('saved-source changes during generation reject stale drafts', async () => {
  await fixture(async (store, initial, root) => {
    await writeFile(path.join(root, 'source.md'), 'Draft scope A.')
    const work = await store.put(
      { ...initial, sources: [{ id: 'source', path: 'source.md', label: '', sensitive: false }] },
      initial.revision,
    )
    const result = await runWorkstream({
      store,
      id: work.id,
      now: NOW,
      propose: async () => {
        await writeFile(path.join(root, 'source.md'), 'The owner changed the scope to B.')
        return review({ artifact: { title: 'Draft A', body: 'Based on obsolete scope A.', activityId: '' } })
      },
    })
    assert({
      given: 'a selected source changes before the effect boundary',
      should: 'discard the obsolete artifact',
      actual: [result.status, (await current(store, work.id)).artifacts.length],
      expected: ['failed', 0],
    })
  })
})

test('prerequisites block only the affected Sky activity and peer results wake the dependent workstream', async () => {
  await fixture(async (store, initial) => {
    const approval = ActivitySchema.parse({ id: 'approval', title: 'Approve scope', kind: 'decision' })
    const other = await store.create({ title: 'Pilot approvals', activities: [approval] }, NOW)
    const blocked = ActivitySchema.parse({
      id: 'blocked',
      title: 'Prepare the final plan',
      executor: 'sky',
      requires: [{ workstreamId: other.id, activityId: approval.id, result: 'Approved scope' }],
    })
    const independent = ActivitySchema.parse({ id: 'independent', title: 'Assemble known questions', executor: 'sky' })
    const work = await enable(
      store,
      await store.put({ ...initial, activities: [blocked, independent] }, initial.revision),
    )
    const eligible: unknown[] = []
    const propose = async (context: Record<string, unknown>) => {
      eligible.push(context.eligibleActivityIds)
      return review()
    }
    await runWorkstream({ store, id: work.id, now: NOW, trigger: 'scheduled', propose })
    const freshOther = await current(store, other.id)
    await store.put(
      {
        ...freshOther,
        activities: freshOther.activities.map((activity) => ({
          ...activity,
          state: 'done',
          result: 'Owner approved scope.',
        })),
      },
      freshOther.revision,
    )
    const second = await runWorkstream({ store, id: work.id, now: '2025-03-15T09:05', trigger: 'scheduled', propose })
    assert({
      given: 'one blocked activity and an independent activity, followed by prerequisite approval',
      should: 'advance independent work and promptly revisit newly eligible work',
      actual: [eligible, second.status],
      expected: [[['independent'], ['blocked', 'independent']], 'completed'],
    })
  })
})

test('reports receive only audience-permitted sources and record preparation rather than delivery', async () => {
  await fixture(async (store, initial, root) => {
    await writeFile(path.join(root, 'public.md'), 'The pilot started.')
    await writeFile(path.join(root, 'private.md'), 'Sensitive compensation figure.')
    const work = await enable(
      store,
      await store.put(
        {
          ...initial,
          understanding: 'Sensitive compensation figure.',
          sources: [
            { id: 'public', path: 'public.md', label: '', sensitive: false },
            { id: 'private', path: 'private.md', label: '', sensitive: true },
          ],
          reporting: [
            ReportingSchema.parse({
              id: 'team',
              audience: 'Pilot team',
              permittedSourceIds: ['public', 'private'],
              allowSensitive: false,
              artifacts: ['presentation', 'video'],
            }),
          ],
        },
        initial.revision,
      ),
    )
    let contextText = ''
    const result = await runWorkstream({
      store,
      id: work.id,
      now: NOW,
      trigger: 'scheduled',
      report: async (context) => {
        contextText = JSON.stringify(context)
        return {
          title: 'Pilot update',
          body: 'The pilot started. Presentation outline: progress and next steps.',
          missingInputs: ['Record the video and add its link.'],
        }
      },
      propose: async () => {
        throw new Error('Reports must not receive general review context')
      },
    })
    const saved = await current(store, work.id)
    const artifact = await store.readArtifact(work.id, result.artifactIds[0])
    assert({
      given: 'a summary audience that excludes sensitive sources',
      should: 'filter before generation and preserve the missing video input',
      actual: [
        contextText.includes('Sensitive compensation'),
        contextText.includes('The pilot started.'),
        saved.reporting[0].lastPreparedAt,
        saved.artifacts[0].kind,
        artifact.content.includes('Record the video'),
      ],
      expected: [false, true, NOW, 'report', true],
    })
  })
})

test('paused work and cumulative effort limits prevent new model work', async () => {
  await fixture(async (store, initial) => {
    const work = await enable(store, initial, { maxRunsTotal: 1 })
    let calls = 0
    const propose = async () => {
      calls++
      return review()
    }
    await runWorkstream({ store, id: work.id, now: NOW, propose })
    const exhausted = await runWorkstream({ store, id: work.id, now: '2025-03-15T10:00', propose })
    const fresh = await current(store, work.id)
    await store.put({ ...fresh, state: 'paused' }, fresh.revision)
    const paused = await runWorkstream({ store, id: work.id, now: '2025-03-15T11:00', propose })
    assert({
      given: 'an exhausted budget and then a paused lifecycle',
      should: 'preserve both boundaries without another model call',
      actual: [
        calls,
        exhausted.status,
        exhausted.summary.includes('effort limit'),
        paused.status,
        paused.summary.includes('paused'),
      ],
      expected: [1, 'nothing', true, 'nothing', true],
    })
  })
})

test('interrupted attempts are reconciled and require owner review before scheduled retry', async () => {
  await fixture(async (store, initial) => {
    const work = await enable(store, initial)
    await store.putRun({
      id: 'interrupted-attempt',
      workstreamId: work.id,
      status: 'running',
      trigger: 'scheduled',
      started: NOW,
      summary: 'Preparing a draft',
      artifactIds: [],
    })
    const result = await runWorkstream({
      store,
      id: work.id,
      now: '2025-03-15T09:05',
      trigger: 'scheduled',
      propose: async () => {
        throw new Error('Must reconcile first')
      },
    })
    assert({
      given: 'a process stopped before confirming its local effects',
      should: 'record interruption without blindly repeating it',
      actual: [result.status, (await store.runs(work.id))[0].status],
      expected: ['nothing', 'interrupted'],
    })
  })
})

test('automatic review does not multiply actions or silently replace the accepted outcome', async () => {
  await fixture(async (store, initial) => {
    const work = await enable(store, initial)
    const proposal = review({
      outcomeSuggestion: 'A different finish line.',
      decisions: [{ question: 'Which scope?', context: 'Two options remain.', recommendation: 'Start small.' }],
      activities: [
        { title: 'Prepare a scoped brief', description: '', executor: 'sky' },
        { title: 'Collect feedback', description: '', executor: 'human' },
      ],
      subworkstreams: [
        { title: 'Pilot launch', outcome: 'Launch the pilot.', reason: 'The launch needs its own coordination.' },
      ],
    })
    await runWorkstream({ store, id: work.id, now: NOW, propose: async () => proposal })
    const saved = await current(store, work.id)
    assert({
      given: 'a model suggests more work and a changed outcome',
      should: 'add at most two activities and keep the outcome change reviewable',
      actual: [saved.activities.length, saved.outcome, saved.proposals.map((item) => item.kind)],
      expected: [2, 'Complete a useful pilot.', ['outcome', 'subworkstream']],
    })
  })
})

test('a new deadline day wakes work even before a long review cadence', async () => {
  await fixture(async (store, initial) => {
    const work = await enable(store, await store.put({ ...initial, due: '2025-03-16' }, initial.revision), {
      reviewEveryHours: 72,
    })
    let calls = 0
    const propose = async () => {
      calls++
      return review({ nextCheckMinutes: 4320 })
    }
    await runWorkstream({ store, id: work.id, now: NOW, trigger: 'scheduled', propose })
    await runWorkstream({ store, id: work.id, now: '2025-03-16T00:05', trigger: 'scheduled', propose })
    assert({
      given: 'a deadline arrives before the next periodic review',
      should: 'wake Sky for the changed timing condition',
      actual: calls,
      expected: 2,
    })
  })
})

test('a damaged checkpoint is surfaced instead of resetting and replaying work', async () => {
  await fixture(async (store, initial) => {
    const work = await enable(store, initial)
    await mkdir(store.stateDir, { recursive: true })
    await writeFile(path.join(store.stateDir, `${work.id}.review.json`), '{broken')
    const result = await scanWorkstreams({
      store,
      now: NOW,
      propose: async () => {
        throw new Error('Must not silently reset')
      },
    })
    assert({
      given: 'a damaged deduplication checkpoint',
      should: 'surface the repair need without writing a new model result',
      actual: [result.outcome, result.failed, (await store.runs(work.id)).length],
      expected: ['failed', 1, 0],
    })
  })
})

test('communication preparation is a local reviewed intent with stable identity and source revisions', async () => {
  await fixture(async (store, initial, root) => {
    await writeFile(path.join(root, 'source.md'), 'Jane Doe requested a pilot update.')
    const activity = ActivitySchema.parse({ id: 'reply', title: 'Prepare the pilot update', executor: 'sky' })
    const work = await store.put(
      {
        ...initial,
        activities: [activity],
        sources: [{ id: 'source', path: 'source.md', label: '', sensitive: false }],
      },
      initial.revision,
    )
    let captured: Record<string, unknown> = {}
    const result = await runWorkstream({
      store,
      id: work.id,
      now: NOW,
      propose: async () =>
        review({
          communication: {
            activityId: 'reply',
            title: 'Pilot update',
            draft: 'The scope is awaiting confirmation.',
            medium: 'Email',
            destination: 'jane@example.com',
            sourceRef: '',
          },
        }),
      prepareCommunication: async (input) => {
        captured = input
        const latest = await current(store, work.id)
        const saved = await store.put(
          { ...latest, activities: latest.activities.map((item) => ({ ...item, outboxId: 'local-review' })) },
          latest.revision,
        )
        return { workstream: saved, item: { id: 'local-review' } }
      },
    })
    const sourceText = await readFile(path.join(root, 'source.md'), 'utf8')
    assert({
      given: 'a model prepares an authorized activity communication',
      should: 'use a stable local intent with original sources, without claiming sending',
      actual: [
        result.status,
        captured.intentId,
        captured.allowManual,
        Object.keys(captured.expectedSourceVersions as object),
        result.summary.includes('has not been sent'),
        sourceText.includes('Jane Doe'),
      ],
      expected: ['completed', 'activity-reply', true, ['source'], true, true],
    })
  })
})

test('failure attention stays visible without waking itself or repeating identical status writes', async () => {
  await fixture(async (store, initial) => {
    const work = await enable(store, initial)
    let calls = 0
    const propose = async () => {
      calls++
      throw new Error('The model is unavailable.')
    }
    const first = await runWorkstream({ store, id: work.id, now: NOW, trigger: 'scheduled', propose })
    const afterFailure = await current(store, work.id)
    const second = await runWorkstream({ store, id: work.id, now: '2025-03-15 09:05', trigger: 'scheduled', propose })
    const afterQuietCheck = await current(store, work.id)
    assert({
      given: 'a scheduled model failure followed by the next scan',
      should: 'show the issue and back off without rewriting the card',
      actual: [
        first.status,
        second.status,
        calls,
        afterFailure.sky.error?.includes('model is unavailable'),
        afterFailure.revision === afterQuietCheck.revision,
      ],
      expected: ['failed', 'nothing', 1, true, true],
    })
  })
})

test('an explicitly permitted workstream source can supply a report without a self-trigger loop', async () => {
  await fixture(async (store, initial) => {
    const work = await enable(
      store,
      await store.put(
        {
          ...initial,
          sources: [{ id: 'own-work', path: initial.path, label: 'Current work', sensitive: false }],
          reporting: [ReportingSchema.parse({ id: 'owner', audience: 'Owner', permittedSourceIds: ['own-work'] })],
        },
        initial.revision,
      ),
    )
    let supplied = ''
    await runWorkstream({
      store,
      id: work.id,
      now: NOW,
      trigger: 'scheduled',
      report: async (context) => {
        supplied = JSON.stringify(context.sources)
        return { title: 'Pilot update', body: 'The pilot outcome remains the target.', missingInputs: [] }
      },
    })
    const next = await runWorkstream({
      store,
      id: work.id,
      now: '2025-03-15 09:05',
      trigger: 'scheduled',
      propose: async () => {
        throw new Error('Own report must not retrigger review')
      },
    })
    assert({
      given: 'a reporting policy explicitly permits the workstream itself',
      should: 'include meaningful work facts and ignore reporting bookkeeping as a wake-up',
      actual: [supplied.includes('Complete a useful pilot.'), supplied.includes('lastReviewedAt'), next.status],
      expected: [true, false, 'nothing'],
    })
  })
})

test('Sky does not execute proposed activities or parent pointers to sub-workstreams', async () => {
  await fixture(async (store, initial) => {
    const child = await store.create({ title: 'Pilot launch', parentId: initial.id }, NOW)
    const work = await enable(
      store,
      await store.put(
        {
          ...initial,
          activities: [
            ActivitySchema.parse({ id: 'proposal', title: 'Unaccepted action', executor: 'sky', state: 'proposed' }),
            ActivitySchema.parse({
              id: 'child-pointer',
              title: 'Launch work',
              executor: 'sky',
              subworkstreamId: child.id,
            }),
            ActivitySchema.parse({ id: 'ready', title: 'Prepare questions', executor: 'sky' }),
          ],
        },
        initial.revision,
      ),
    )
    let seen: unknown
    await runWorkstream({
      store,
      id: work.id,
      now: NOW,
      propose: async (context) => {
        seen = context.eligibleActivityIds
        return review()
      },
    })
    assert({
      given: 'unaccepted and promoted work beside a ready Sky action',
      should: 'execute only the accepted canonical activity',
      actual: seen,
      expected: ['ready'],
    })
  })
})

test('a repeated preparation reuses the existing local artifact', async () => {
  await fixture(async (store, initial) => {
    const proposal = review({ artifact: { title: 'Pilot outline', body: 'One existing preparation.', activityId: '' } })
    await runWorkstream({ store, id: initial.id, now: NOW, propose: async () => proposal })
    let previous: unknown
    const repeated = await runWorkstream({
      store,
      id: initial.id,
      now: '2025-03-15 10:00',
      propose: async (context) => {
        previous = context.previousArtifacts
        return proposal
      },
    })
    assert({
      given: 'another invocation returns the same draft',
      should: 'read prior results and avoid multiplying identical artifacts',
      actual: [
        (await current(store, initial.id)).artifacts.length,
        repeated.artifactIds.length,
        JSON.stringify(previous).includes('One existing preparation.'),
      ],
      expected: [1, 0, true],
    })
  })
})

test('parallel invocations coalesce before a second model starts', async () => {
  await fixture(async (store, initial) => {
    let enter!: () => void
    let finish!: () => void
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const released = new Promise<void>((resolve) => {
      finish = resolve
    })
    const first = runWorkstream({
      store,
      id: initial.id,
      now: NOW,
      propose: async () => {
        enter()
        await released
        return review()
      },
    })
    await entered
    const second = await runWorkstream({
      store,
      id: initial.id,
      now: NOW,
      propose: async () => {
        throw new Error('Must not start a second model')
      },
    })
    finish()
    const completed = await first
    assert({
      given: 'a second manual request arrives during model work',
      should: 'coalesce it using the shared runner lease',
      actual: [completed.status, second.status, second.summary.includes('already working')],
      expected: ['completed', 'nothing', true],
    })
  })
})

test('linked Outbox status and captured replies wake Sky without claiming sending or acceptance', async () => {
  await fixture(async (store, initial) => {
    const work = await enable(
      store,
      await store.put(
        {
          ...initial,
          activities: [
            ActivitySchema.parse({
              id: 'reply',
              title: 'Pilot scope request',
              executor: 'sky',
              state: 'waiting',
              outboxId: 'pending-draft',
              waitingFor: 'Review in Outbox.',
            }),
          ],
        },
        initial.revision,
      ),
    )
    let snapshot = {
      id: 'pending-draft',
      status: 'needs_review',
      version: 'review-v1',
      sources: [] as { body: string }[],
    }
    const readCommunications = async () => [snapshot]
    const seen: string[] = []
    const propose = async (context: Record<string, unknown>) => {
      seen.push(JSON.stringify(context.communications))
      return review()
    }
    await runWorkstream({ store, id: work.id, now: NOW, trigger: 'scheduled', readCommunications, propose })
    const unchanged = await runWorkstream({
      store,
      id: work.id,
      now: '2025-03-15 09:05',
      trigger: 'scheduled',
      readCommunications,
      propose,
    })
    snapshot = { ...snapshot, status: 'ready', version: 'native-draft-v2' }
    await runWorkstream({
      store,
      id: work.id,
      now: '2025-03-15 09:10',
      trigger: 'scheduled',
      readCommunications,
      propose,
    })
    snapshot = { ...snapshot, version: 'capture-v3', sources: [{ body: 'Please revise the pilot scope.' }] }
    await runWorkstream({
      store,
      id: work.id,
      now: '2025-03-15 09:15',
      trigger: 'scheduled',
      readCommunications,
      propose,
    })
    const saved = await current(store, work.id)
    assert({
      given: 'a pending draft becomes native-ready and later receives a captured response',
      should: 'reassess each new fact without inventing sending, acceptance, or completion',
      actual: [
        unchanged.status,
        seen.length,
        seen[1].includes('ready'),
        seen[2].includes('Please revise'),
        saved.activities[0].state,
        saved.state,
        saved.activities[0].outboxId,
      ],
      expected: ['nothing', 3, true, true, 'waiting', 'active', 'pending-draft'],
    })
  })
})
