import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { ActionVerificationSchema, type ActionAssessment } from './actionOutcome.ts'
import { WorkstreamReviewSchema, type WorkstreamReview } from './ai.ts'
import { runWorkstream } from './runner.ts'
import { WorkstreamStore } from './store.ts'
import { ActivitySchema, SkySchema, type WorkstreamRecord } from './types.ts'

const NOW = '2025-03-15 09:00'
const INITIAL = 'The pilot scope needs a delivery date.'
const CONFIRMED = 'The pilot delivery date is 2025-03-31.'
const TITLE = 'Prepare the pilot scope'
const review = (changes: Partial<WorkstreamReview> = {}): WorkstreamReview =>
  WorkstreamReviewSchema.parse({
    summary: 'Check the agreed pilot work.',
    understanding: 'The scope uses the supplied customer input.',
    outcomeSuggestion: '',
    unknowns: [],
    activities: [],
    decisions: [],
    relationships: [],
    suggestions: [],
    subworkstreams: [],
    artifact: null,
    communication: null,
    waitingFor: '',
    nextCheckMinutes: 1440,
    ...changes,
  })

async function fixture(run: (store: WorkstreamStore, work: WorkstreamRecord, root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-action-rework-'))
  try {
    const store = new WorkstreamStore(path.join(root, 'workstreams'), path.join(root, 'state'), root)
    await writeFile(path.join(root, 'feedback.md'), INITIAL)
    let work = await store.create(
      {
        id: 'atlas',
        title: 'Atlas pilot',
        sources: [{ id: 'feedback', path: 'feedback.md', label: 'Pilot input', sensitive: false }],
        activities: [ActivitySchema.parse({ id: 'scope', title: TITLE, executor: 'sky', state: 'ready' })],
      },
      NOW,
    )
    work = await store.configureSky(
      work.id,
      SkySchema.parse({
        mode: 'drive',
        actionPolicies: {
          scope: {
            mode: 'deliverable',
            successCriteria: 'Describe the pilot scope and supplied delivery date.',
            requiredSourceIds: ['feedback'],
          },
        },
      }),
      work.revision,
    )
    await run(store, work, root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const assessment = (quote: string, changes: Partial<ActionAssessment> = {}): ActionAssessment => ({
  satisfied: true,
  rationale: 'The artifact includes the supplied scope and date.',
  artifactEvidence: [quote],
  sourceEvidence: [{ sourceId: 'feedback', quote }],
  missingInputs: [],
  requiresExternalResult: false,
  ...changes,
})

test('a delegated action resumes on new evidence and completes the same activity without a manual reset', async () => {
  await fixture(async (store, work, root) => {
    let proposed = 0
    const first = await runWorkstream({
      store,
      id: work.id,
      now: NOW,
      trigger: 'scheduled',
      propose: async () => {
        proposed++
        return review({ artifact: { activityId: 'scope', title: 'Pilot scope', body: INITIAL } })
      },
      verifyAction: async () =>
        assessment(INITIAL, { satisfied: false, missingInputs: ['The delivery date is not yet supplied.'] }),
    })
    const waiting = (await store.get(work.id))!
    const unchanged = await runWorkstream({
      store,
      id: work.id,
      now: '2025-03-15 09:05',
      trigger: 'scheduled',
      propose: async () => {
        throw new Error('Unchanged waiting work must not call the model again.')
      },
    })
    await writeFile(path.join(root, 'feedback.md'), CONFIRMED)
    const resumed = await runWorkstream({
      store,
      id: work.id,
      now: '2025-03-15 09:10',
      trigger: 'scheduled',
      propose: async (context) => {
        proposed++
        assert({
          given: 'new selected evidence for a waiting delegated deliverable',
          should: 'resume the existing scoped activity',
          actual: context.eligibleActivityIds,
          expected: ['scope'],
        })
        return review({ artifact: { activityId: 'scope', title: 'Pilot scope', body: CONFIRMED } })
      },
      verifyAction: async () => assessment(CONFIRMED),
    })
    const completed = (await store.get(work.id))!
    const after = await runWorkstream({
      store,
      id: work.id,
      now: '2025-03-15 09:15',
      trigger: 'scheduled',
      propose: async () => {
        throw new Error('Completing the rework must not trigger another run.')
      },
    })
    assert({
      given: 'missing input, an unchanged check, then the actual input arriving',
      should: 'wait without self-triggering and complete the revised artifact under the original authority',
      actual: [
        first.status,
        waiting.activities[0].state,
        unchanged.status,
        resumed.status,
        proposed,
        completed.activities.length,
        completed.activities[0].id,
        completed.activities[0].state,
        completed.activities[0].actionVerification?.outcome,
        completed.artifacts.length,
        after.status,
      ],
      expected: ['completed', 'waiting', 'nothing', 'completed', 2, 1, 'scope', 'done', 'accepted', 2, 'nothing'],
    })
  })
})

test('an unmet quality criterion schedules one authorized revision without waiting for owner input', async () => {
  await fixture(async (store, work) => {
    await runWorkstream({
      store,
      id: work.id,
      now: NOW,
      trigger: 'scheduled',
      propose: async () => review({ artifact: { activityId: 'scope', title: 'Pilot scope', body: INITIAL } }),
      verifyAction: async () =>
        assessment(INITIAL, { satisfied: false, rationale: 'The scope needs a clearer explanation of the open date.' }),
    })
    const revision = (await store.get(work.id))!
    const early = await runWorkstream({
      store,
      id: work.id,
      now: '2025-03-15 09:05',
      trigger: 'scheduled',
      propose: async () => {
        throw new Error('Wait for the scheduled revision.')
      },
    })
    const revised = await runWorkstream({
      store,
      id: work.id,
      now: '2025-03-15 09:15',
      trigger: 'scheduled',
      propose: async (context) => {
        assert({
          given: 'a failed quality check with sufficient grounded inputs',
          should: 'retain delegated responsibility for revising the same action',
          actual: context.eligibleActivityIds,
          expected: ['scope'],
        })
        return review({
          artifact: {
            activityId: 'scope',
            title: 'Pilot scope',
            body: `${INITIAL} Establish the date before scheduling the pilot.`,
          },
        })
      },
      verifyAction: async () => assessment(INITIAL),
    })
    assert({
      given: 'a quality failure with no missing inputs or evidence errors',
      should: 'schedule revision at fifteen minutes and then accept the improved deliverable',
      actual: [
        revision.activities[0].state,
        revision.sky.nextReviewAt,
        early.status,
        revised.status,
        (await store.get(work.id))!.activities[0].state,
      ],
      expected: ['ready', '2025-03-15 09:15', 'nothing', 'completed', 'done'],
    })
  })
})

test('fresh context never grants proposed, human, ordinary review, or external-result waits execution', async () => {
  await fixture(async (store, work, root) => {
    const verified = ActionVerificationSchema.parse({
      ...assessment(INITIAL, { satisfied: false }),
      outcome: 'needs_review',
      reasons: ['The supplied date needs checking.'],
      runId: 'prior',
      checkedAt: NOW,
      policyRevision: (await store.getGrant(work.id)).revision,
      sourceVersions: {},
    })
    const candidates = [
      { id: 'scope', title: TITLE, state: 'waiting', actionVerification: verified },
      { id: 'proposed', title: 'An unaccepted suggestion', state: 'proposed', actionVerification: verified },
      { id: 'human', title: 'Human work', executor: 'human', state: 'waiting', actionVerification: verified },
      { id: 'review', title: 'Review the ordinary draft', state: 'waiting', actionVerification: verified },
      { id: 'unassessed', title: 'An unassessed draft', state: 'waiting' },
      {
        id: 'external',
        title: 'Obtain the signed agreement',
        state: 'waiting',
        actionVerification: { ...verified, requiresExternalResult: true },
      },
    ].map((activity) => ActivitySchema.parse({ executor: 'sky', ...activity }))
    work = await store.put({ ...work, activities: candidates }, work.revision)
    work = await store.configureSky(
      work.id,
      SkySchema.parse({
        ...work.sky,
        actionPolicies: Object.fromEntries(
          candidates
            .filter((activity) => activity.id !== 'review')
            .map((activity) => [
              activity.id,
              {
                mode: 'deliverable',
                successCriteria: 'Create a local scope using supplied input.',
                requiredSourceIds: ['feedback'],
              },
            ]),
        ),
      }),
      work.revision,
    )
    // The first scheduled pass establishes a checkpoint; it is not evidence of new inputs to a prior wait.
    await runWorkstream({
      store,
      id: work.id,
      now: NOW,
      trigger: 'scheduled',
      propose: async (context) => {
        assert({
          given: 'waiting activities with no known fresh-context checkpoint',
          should: 'keep their existing waits',
          actual: context.eligibleActivityIds,
          expected: [],
        })
        return review()
      },
    })
    await writeFile(path.join(root, 'feedback.md'), CONFIRMED)
    const observed: unknown[] = []
    await runWorkstream({
      store,
      id: work.id,
      now: '2025-03-15 09:05',
      trigger: 'scheduled',
      propose: async (context) => {
        observed.push(context.eligibleActivityIds)
        return review()
      },
    })
    await runWorkstream({
      store,
      id: work.id,
      now: '2025-03-15 09:10',
      trigger: 'manual',
      request: 'Recheck the delegated scope.',
      propose: async (context) => {
        observed.push(context.eligibleActivityIds)
        return review()
      },
    })
    assert({
      given: 'fresh selected context and then an explicit manual request',
      should: 'resume only the already delegated, assessed local action',
      actual: observed,
      expected: [['scope'], ['scope']],
    })
  })
})

test('unverifiable assessment evidence waits for fresh context instead of repeatedly revising', async () => {
  await fixture(async (store, work) => {
    await runWorkstream({
      store,
      id: work.id,
      now: NOW,
      trigger: 'scheduled',
      propose: async () => review({ artifact: { activityId: 'scope', title: 'Pilot scope', body: INITIAL } }),
      verifyAction: async () => assessment('This quote does not exist.', { satisfied: false }),
    })
    const waiting = (await store.get(work.id))!
    const next = await runWorkstream({
      store,
      id: work.id,
      now: '2025-03-15 09:15',
      trigger: 'scheduled',
      propose: async () => {
        throw new Error('An evidence failure needs fresh inputs, not a repeated draft.')
      },
    })
    assert({
      given: 'a quality failure whose claimed evidence cannot be verified',
      should: 'keep the action waiting without the immediate revision loop',
      actual: [waiting.activities[0].state, waiting.activities[0].actionVerification?.outcome, next.status],
      expected: ['waiting', 'needs_review', 'nothing'],
    })
  })
})
