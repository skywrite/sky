import { assert, test } from '#test'
import { acceptCoordination } from './coordinateWork.ts'
import { WorkstreamSchema } from './types.ts'

test('accepting proposed coordination preserves identities without granting new permissions', () => {
  const work = WorkstreamSchema.parse({
    id: 'atlas',
    title: 'Atlas pilot',
    created: '2025-03-15 09:00',
    updated: '2025-03-15 09:00',
    stakeholders: [{ id: 'jane', name: 'Jane Doe', role: 'Contributor' }],
    reporting: [
      { id: 'team', audience: 'Pilot team', medium: 'email', permittedSourceIds: ['summary'], allowSensitive: false },
    ],
  })
  const accepted = acceptCoordination(work, {
    stakeholders: [
      { name: 'Jane Doe', role: 'Reviewer', basis: 'stated', reason: 'The owner identified the reviewer.' },
    ],
    timeline: { due: '2025-03-31', basis: 'stated', reason: 'The owner supplied this deadline.' },
    reporting: [
      {
        audience: 'Pilot team',
        medium: 'email',
        cadenceDays: 3,
        instructions: 'Report useful progress.',
        detail: 'operational',
        artifacts: [],
        reason: 'The owner requested updates.',
        basis: 'stated',
      },
      {
        audience: 'Pilot sponsors',
        medium: 'email',
        destination: 'sponsor@example.com',
        cadenceDays: 7,
        instructions: 'A brief weekly update.',
        detail: 'summary',
        artifacts: ['Presentation'],
        reason: 'Proposed cadence for review.',
        basis: 'suggested',
      },
    ],
  })
  assert({
    given: 'accepted stakeholder, timing and audience proposals',
    should: 'update metadata while keeping source disclosure and sending separately authorized',
    actual: [
      accepted.stakeholders?.length,
      accepted.stakeholders?.[0].id,
      accepted.stakeholders?.[0].role,
      accepted.due,
      accepted.reporting?.[0].id,
      accepted.reporting?.[0].permittedSourceIds,
      accepted.reporting?.[1].permittedSourceIds,
      accepted.reporting?.[1].allowSensitive,
      accepted.sky,
    ],
    expected: [1, 'jane', 'Reviewer', '2025-03-31', 'team', ['summary'], [], false, undefined],
  })
})

test('a partial timing proposal cannot silently contradict the accepted deadline', () => {
  const work = WorkstreamSchema.parse({
    id: 'atlas',
    title: 'Atlas pilot',
    created: '2025-03-15 09:00',
    updated: '2025-03-15 09:00',
    due: '2025-03-31',
  })
  let refused = false
  try {
    acceptCoordination(work, {
      timeline: { start: '2025-04-01', reason: 'Proposed revised start.', basis: 'suggested' },
    })
  } catch {
    refused = true
  }
  assert({
    given: 'a proposed start after an existing deadline',
    should: 'keep the existing dates until the owner reviews them together',
    actual: [refused, work.due, work.start],
    expected: [true, '2025-03-31', undefined],
  })
})
