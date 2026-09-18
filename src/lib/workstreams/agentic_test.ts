import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { WorkstreamReviewSchema } from './ai.ts'
import { DecisionAssessmentSchema } from './decisionPolicy.ts'
import { runWorkstream } from './runner.ts'
import { WorkstreamStore } from './store.ts'
import { ActivitySchema, SkySchema } from './types.ts'

test('ongoing Sky work decides within authority and completes the newly unblocked deliverable', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-agentic-work-'))
  try {
    const store = new WorkstreamStore(path.join(root, 'workstreams'), path.join(root, 'state'), root)
    await writeFile(path.join(root, 'feedback.md'), 'Jane recommends an invited cohort. Start with existing customers.')
    let work = await store.create(
      {
        id: 'atlas',
        title: 'Launch the Atlas pilot',
        sources: [
          { id: 'feedback', path: 'feedback.md', label: 'Customer input', sensitive: false, stakeholderIds: ['jane'] },
        ],
        stakeholders: [{ id: 'jane', name: 'Jane Doe', role: 'Contributor', contact: '' }],
        activities: [
          ActivitySchema.parse({ id: 'choose', title: 'Choose the pilot cohort', kind: 'decision', executor: 'sky' }),
          ActivitySchema.parse({
            id: 'scope',
            title: 'Prepare the pilot scope',
            executor: 'sky',
            requires: [{ workstreamId: 'atlas', activityId: 'choose', result: 'Chosen cohort' }],
          }),
        ],
      },
      '2025-03-15 09:00',
    )
    work = await store.configureSky(
      work.id,
      SkySchema.parse({
        mode: 'drive',
        decisionPolicies: {
          choose: {
            mode: 'delegate',
            instruction: 'Choose among the agreed pilot cohorts using customer input.',
            options: [{ id: 'invited', label: 'Invited existing customers' }],
            requiredSourceIds: ['feedback'],
            requiredStakeholderIds: ['jane'],
          },
        },
        actionPolicies: {
          scope: {
            mode: 'deliverable',
            successCriteria: 'Describe the chosen cohort and a learning target.',
            requiredSourceIds: ['feedback'],
          },
        },
      }),
      work.revision,
    )
    const base = {
      summary: 'Continue the agreed pilot work.',
      understanding: 'Customer input supports an invited cohort.',
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
    }
    const first = await runWorkstream({
      store,
      id: work.id,
      now: '2025-03-15 09:00',
      trigger: 'scheduled',
      propose: async (context) => {
        assert({
          given: 'an unresolved prerequisite',
          should: 'keep the downstream action ineligible',
          actual: context.eligibleActivityIds,
          expected: [],
        })
        return WorkstreamReviewSchema.parse({
          ...base,
          decisionAssessments: [
            DecisionAssessmentSchema.parse({
              activityId: 'choose',
              choiceId: 'invited',
              recommendation: 'Use invited existing customers.',
              rationale: 'The supplied contributor input supports learning with an invited cohort.',
              confidence: 0.95,
              options: [
                {
                  id: 'invited',
                  label: 'Invited existing customers',
                  advantages: ['Focused learning'],
                  disadvantages: ['Limited reach'],
                },
              ],
              evidence: [{ sourceId: 'feedback', quote: 'Start with existing customers.' }],
              assumptionIds: [],
              stakeholderEvidence: [
                { stakeholderId: 'jane', sourceId: 'feedback', quote: 'Jane recommends an invited cohort.' },
              ],
              risks: ['The cohort may not represent all customers.'],
              contradictions: [],
              requiresHuman: false,
              escalationReason: '',
            }),
          ],
        })
      },
    })
    const afterDecision = (await store.get(work.id))!
    const second = await runWorkstream({
      store,
      id: work.id,
      now: '2025-03-15 09:15',
      trigger: 'scheduled',
      propose: async (context) => {
        assert({
          given: 'a decision resolved within the exact delegated authority',
          should: 'make its downstream action eligible without a manual nudge',
          actual: context.eligibleActivityIds,
          expected: ['scope'],
        })
        return WorkstreamReviewSchema.parse({
          ...base,
          artifact: {
            activityId: 'scope',
            title: 'Pilot scope',
            body: 'Invite existing customers. Measure whether they reach the first useful result.',
          },
        })
      },
      verifyAction: async () => ({
        satisfied: true,
        rationale: 'The document specifies the agreed cohort and measurable learning target.',
        artifactEvidence: ['Invite existing customers.', 'Measure whether they reach the first useful result.'],
        sourceEvidence: [{ sourceId: 'feedback', quote: 'Start with existing customers.' }],
        missingInputs: [],
        requiresExternalResult: false,
      }),
    })
    const final = (await store.get(work.id))!
    assert({
      given: 'two scheduled turns under explicit decision and deliverable authority',
      should: 'retain the decision evidence and complete the real local deliverable',
      actual: [
        first.status,
        afterDecision.activities[0].state,
        afterDecision.activities[0].decisionResolution?.actor,
        afterDecision.activities[0].decisionResolution?.stakeholderEvidence[0].stakeholderId,
        second.status,
        final.activities[1].state,
        final.activities[1].actionVerification?.outcome,
        final.artifacts.length,
      ],
      expected: ['completed', 'done', 'sky', 'jane', 'completed', 'done', 'accepted', 1],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
