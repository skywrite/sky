import { assert, test } from '#test'
import parseMessageLink from './parseMessageLink.ts'

test('parseMessageLink: workspace archive link', () => {
  assert({
    given: 'a workspace archive p-link',
    should: 'parse channel and dotted ts, root defaulting to the message itself',
    actual: parseMessageLink('https://acme.slack.com/archives/C12345678/p1739447467000123'),
    expected: { channelId: 'C12345678', messageTs: '1739447467.000123', rootTs: '1739447467.000123' },
  })
})

test('parseMessageLink: reply link with thread_ts param', () => {
  assert({
    given: 'a reply permalink carrying thread_ts and cid params',
    should: 'take the thread_ts param as the root',
    actual: parseMessageLink(
      'https://acme.slack.com/archives/C12345678/p1739450000111222?thread_ts=1739447467.000123&cid=C12345678',
    ),
    expected: { channelId: 'C12345678', messageTs: '1739450000.111222', rootTs: '1739447467.000123' },
  })
})

test('parseMessageLink: app.slack.com archive link', () => {
  assert({
    given: 'an archive p-link on the app.slack.com host',
    should: 'parse the same as a workspace link',
    actual: parseMessageLink('https://app.slack.com/archives/D0ABCDEF0/p1739447467000123'),
    expected: { channelId: 'D0ABCDEF0', messageTs: '1739447467.000123', rootTs: '1739447467.000123' },
  })
})

test('parseMessageLink: slack:// deeplink', () => {
  assert({
    given: 'a slack:// deeplink with id and dotted message ts',
    should: 'parse channel and ts from query params',
    actual: parseMessageLink('slack://channel?team=T111&id=C12345678&message=1739447467.000123'),
    expected: { channelId: 'C12345678', messageTs: '1739447467.000123', rootTs: '1739447467.000123' },
  })
})

test('parseMessageLink: slack:// deeplink with digit ts and thread_ts', () => {
  assert({
    given: 'a slack:// deeplink with undotted message digits and a thread_ts param',
    should: 'dot the message ts and take thread_ts as the root',
    actual: parseMessageLink(
      'slack://channel?team=T111&id=C12345678&message=1739450000111222&thread_ts=1739447467.000123',
    ),
    expected: { channelId: 'C12345678', messageTs: '1739450000.111222', rootTs: '1739447467.000123' },
  })
})

test('parseMessageLink: client view link returns undefined', () => {
  assert({
    given: 'an app client link that names no message',
    should: 'return undefined',
    actual: parseMessageLink('https://app.slack.com/client/T111/C12345678'),
    expected: undefined,
  })
})

test('parseMessageLink: trailing junk after ts digits returns undefined', () => {
  assert({
    given: 'an archive-shaped path with characters after the ts digits',
    should: 'return undefined',
    actual: parseMessageLink('https://acme.slack.com/archives/C12345678/p1739447467000123x'),
    expected: undefined,
  })
})

test('parseMessageLink: garbage returns undefined', () => {
  assert({
    given: 'a string that is not a URL',
    should: 'return undefined',
    actual: parseMessageLink('not-a-url'),
    expected: undefined,
  })
})

test('parseMessageLink: trims whitespace', () => {
  assert({
    given: 'a link with surrounding whitespace',
    should: 'still parse',
    actual: parseMessageLink('  https://acme.slack.com/archives/C12345678/p1739447467000123  '),
    expected: { channelId: 'C12345678', messageTs: '1739447467.000123', rootTs: '1739447467.000123' },
  })
})
