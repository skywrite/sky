/**
 * Tests for reference field mappings.
 */

import { assert, test } from '#test'
import { getAllRefFields, getOrgFields, getPersonFields, refFields } from './refs.ts'

// =============================================================================
// refFields structure
// =============================================================================

test('refFields - meeting has who and relSet', () => {
  assert({
    given: 'meeting type',
    should: 'have who field as person',
    actual: refFields.meeting.who,
    expected: 'person',
  })

  assert({
    given: 'meeting type',
    should: 'have relSet field as any',
    actual: refFields.meeting.relSet,
    expected: 'any',
  })
})

test('refFields - message has from, to, and relSet', () => {
  assert({
    given: 'message type',
    should: 'have from field as person',
    actual: refFields.message.from,
    expected: 'person',
  })

  assert({
    given: 'message type',
    should: 'have to field as person',
    actual: refFields.message.to,
    expected: 'person',
  })
})

test('refFields - person has org, orgs, and relSet', () => {
  assert({
    given: 'person type',
    should: 'have org field as org',
    actual: refFields.person.org,
    expected: 'org',
  })

  assert({
    given: 'person type',
    should: 'have orgs field as org',
    actual: refFields.person.orgs,
    expected: 'org',
  })
})

// =============================================================================
// getPersonFields
// =============================================================================

test('getPersonFields - meeting returns who and relSet', () => {
  const fields = getPersonFields('meeting')

  assert({
    given: 'meeting type',
    should: 'include who',
    actual: fields.includes('who'),
    expected: true,
  })

  assert({
    given: 'meeting type',
    should: 'include relSet (any type)',
    actual: fields.includes('relSet'),
    expected: true,
  })
})

test('getPersonFields - message returns from, to, relSet', () => {
  const fields = getPersonFields('message')

  assert({
    given: 'message type',
    should: 'have 3 person-related fields',
    actual: fields.length,
    expected: 3,
  })
})

// =============================================================================
// getOrgFields
// =============================================================================

test('getOrgFields - person returns org, orgs, relSet', () => {
  const fields = getOrgFields('person')

  assert({
    given: 'person type',
    should: 'include org',
    actual: fields.includes('org'),
    expected: true,
  })

  assert({
    given: 'person type',
    should: 'include orgs',
    actual: fields.includes('orgs'),
    expected: true,
  })
})

// =============================================================================
// getAllRefFields
// =============================================================================

test('getAllRefFields - returns all fields', () => {
  const meetingFields = getAllRefFields('meeting')

  assert({
    given: 'meeting type',
    should: 'have 2 ref fields',
    actual: meetingFields.length,
    expected: 2,
  })

  const messageFields = getAllRefFields('message')

  assert({
    given: 'message type',
    should: 'have 3 ref fields',
    actual: messageFields.length,
    expected: 3,
  })
})
