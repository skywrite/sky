import { ActivitySchema, WorkstreamSchema } from '#lib/workstreams/types.ts'
import { assert, test } from '#test'
import {
  proposalRelationship,
  relationshipChanges,
  relationshipLabel,
  relationshipsFor,
  requiredResultAvailable,
} from './workstreamsRelationshipModel.ts'

const work = (id: string) => WorkstreamSchema.parse({ id, title: id, created: '2025-03-15', updated: '2025-03-15' })

test('editing a prerequisite preserves the activity and its other required results', () => {
  const source = work('atlas')
  source.activities = [
    ActivitySchema.parse({
      id: 'launch',
      title: 'Launch the pilot',
      notes: 'Keep this context.',
      requires: [
        { workstreamId: 'widget', activityId: 'scope', result: 'Scope chosen' },
        { workstreamId: 'support', activityId: 'ready', result: 'Support ready' },
      ],
    }),
  ]
  const previous = {
    kind: 'prerequisite' as const,
    fromId: source.id,
    toId: 'widget',
    activityId: 'launch',
    requiredActivityId: 'scope',
    reason: 'Scope chosen',
  }
  const changes = relationshipChanges(source, { ...previous, reason: 'Pilot scope approved' }, previous)
  assert({
    given: 'a required-result explanation edited from its edge',
    should: 'change that result only and keep its neighboring requirement and activity context',
    actual: [Object.keys(changes), changes.activities?.[0]?.notes, changes.activities?.[0]?.requires],
    expected: [
      ['activities'],
      'Keep this context.',
      [
        { workstreamId: 'support', activityId: 'ready', result: 'Support ready' },
        { workstreamId: 'widget', activityId: 'scope', result: 'Pilot scope approved' },
      ],
    ],
  })
})

test('a prerequisite is available only when its recorded work has completed', () => {
  const source = work('atlas'),
    child = work('research')
  source.activities = [
    ActivitySchema.parse({ id: 'scope', title: 'Scope approved', state: 'done', subworkstreamId: child.id }),
  ]
  const requirement = { workstreamId: source.id, activityId: 'scope', result: 'Scope approved' }
  const before = requiredResultAvailable(requirement, [source, child])
  child.state = 'completed'
  const completed = requiredResultAvailable(requirement, [source, child])
  source.deletion = { id: 'deletion', at: '2025-03-15', previousRevision: 'previous' }
  assert({
    given: 'a required activity expanded into independent work, then its owner deleted',
    should: 'wait for the child outcome and stop treating a deleted prerequisite as available',
    actual: [before, completed, requiredResultAvailable(requirement, [source, child])],
    expected: [false, true, false],
  })
})

test('relationship conversion and removal retain unrelated work', () => {
  const source = work('atlas')
  source.relations = [
    { targetId: 'widget', kind: 'contributes', reason: 'Pilot findings' },
    { targetId: 'support', kind: 'related', reason: 'Shared context' },
  ]
  const previous = { kind: 'contributes' as const, fromId: source.id, toId: 'widget', reason: 'Pilot findings' }
  const changes = relationshipChanges(source, { ...previous, kind: 'parent' }, previous)
  const removal = relationshipChanges({ ...source, ...changes }, null, { ...previous, kind: 'parent' })
  assert({
    given: 'a contribution refined into part of a workstream and then removed',
    should: 'retain other relations and explicitly clear only its parent reference',
    actual: [changes, Object.keys(removal), removal.parentId],
    expected: [{ relations: [source.relations[1]], parentId: 'widget' }, ['parentId'], undefined],
  })
})

test('relationship summaries explain incoming work and preserve inferred prerequisite meaning', () => {
  const source = work('atlas'),
    target = work('widget')
  source.relations = [{ targetId: target.id, kind: 'contributes', reason: 'Pilot findings' }]
  const incoming = relationshipsFor(target, [source, target])
  const preview = proposalRelationship(source, {
    id: 'suggestion',
    kind: 'relation',
    title: 'Need scope approval',
    reason: 'prerequisite: Scope must be approved.',
    targetId: target.id,
  })
  assert({
    given: 'a contribution viewed from its recipient and a legacy prerequisite suggestion',
    should: 'explain the incoming direction and retain the prerequisite until its details are chosen',
    actual: [incoming.map((edge) => relationshipLabel(edge, target.id)), preview?.kind, preview?.activityId],
    expected: [['Contributed to by'], 'prerequisite', undefined],
  })
})
