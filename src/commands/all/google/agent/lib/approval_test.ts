import { assert, test } from '#test'
import { missionApprovalKey, missionNeedsApproval } from './approval.ts'

const DOC_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd'

test('missionNeedsApproval', async (t) => {
  await t.step('a create-only mission runs without a go', () => {
    assert({
      given: 'a mission with no target and no import',
      should: 'need no approval',
      actual: missionNeedsApproval({ mission: 'Create a doc titled Atlas Q3 Plan with: ...' }),
      expected: false,
    })
  })
  await t.step('a mission aimed at an existing file asks', () => {
    assert({
      given: 'a mission with a target file',
      should: 'need approval',
      actual: missionNeedsApproval({ mission: 'Tighten the Outlook section', file: DOC_ID }),
      expected: true,
    })
  })
  await t.step('an import asks', () => {
    assert({
      given: 'a mission importing a local file',
      should: 'need approval',
      actual: missionNeedsApproval({ mission: 'Review this contract', import: '~/deals/atlas-msa.pdf' }),
      expected: true,
    })
  })
})

test('missionApprovalKey', async (t) => {
  await t.step('a targeted mission scopes to its file id', () => {
    assert({
      given: 'a target given as a Docs URL',
      should: 'key on the file id',
      actual: missionApprovalKey({ file: `https://docs.google.com/document/d/${DOC_ID}/edit` }),
      expected: DOC_ID,
    })
  })
  await t.step('a create mission has no key', () => {
    assert({
      given: 'no target',
      should: 'have no key',
      actual: missionApprovalKey({ mission: 'x' }),
      expected: undefined,
    })
  })
})
