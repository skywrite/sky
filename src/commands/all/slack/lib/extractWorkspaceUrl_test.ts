import { assert, test } from '#test'
import extractWorkspaceUrl from './extractWorkspaceUrl.ts'

test('extractWorkspaceUrl: workspace URL', () => {
  assert({
    given: 'a standard workspace URL',
    should: 'return the workspace origin',
    actual: extractWorkspaceUrl('https://acme.slack.com/archives/C12345678/p1234567890'),
    expected: 'https://acme.slack.com',
  })
})

test('extractWorkspaceUrl: app.slack.com URL returns undefined', () => {
  assert({
    given: 'an app.slack.com URL',
    should: 'return undefined (not a workspace URL)',
    actual: extractWorkspaceUrl('https://app.slack.com/client/T123/C456'),
    expected: undefined,
  })
})

test('extractWorkspaceUrl: non-slack URL returns undefined', () => {
  assert({
    given: 'a non-Slack URL',
    should: 'return undefined',
    actual: extractWorkspaceUrl('https://example.com/foo'),
    expected: undefined,
  })
})

test('extractWorkspaceUrl: invalid URL returns undefined', () => {
  assert({
    given: 'an invalid URL string',
    should: 'return undefined',
    actual: extractWorkspaceUrl('not-a-url'),
    expected: undefined,
  })
})

test('extractWorkspaceUrl: trims whitespace', () => {
  assert({
    given: 'a URL with surrounding whitespace',
    should: 'still parse correctly',
    actual: extractWorkspaceUrl('  https://acme.slack.com/archives/C123  '),
    expected: 'https://acme.slack.com',
  })
})
