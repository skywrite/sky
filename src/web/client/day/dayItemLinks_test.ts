import { assert, test } from '#test'
import { itemDocLinked, textParts, webLink } from './dayItemLinks.ts'

const MESSAGE = 'https://example.slack.com/archives/C0000000000/p1700000000000000'
const DOC = 'https://docs.google.com/document/d/abc123/edit'
const VENUE = 'https://www.example.com/venues/riverside-hall?dates=2026-11-12&guests=40'

const slack = { href: MESSAGE, label: 'Slack message', site: 'slack' }
const doc = { href: DOC, label: 'Google Doc', site: 'doc' }
const venue = { href: VENUE, label: 'example.com', site: 'web' }

test('textParts()', () => {
  assert({
    given: 'text with no web address',
    should: 'leave the row to render as it always has',
    actual: [textParts('Call Jane Doe about Atlas'), textParts('Read [the plan](notes/Plan.md)')],
    expected: [null, null],
  })

  assert({
    given: 'an address after a dash',
    should: 'keep the words and drop the dash with the address',
    actual: textParts(`Reply to Jane Doe on Atlas - ${MESSAGE}`),
    expected: ['Reply to Jane Doe on Atlas', slack],
  })

  assert({
    given: 'an address with a query string, and nothing between it and the words',
    should: 'carry the whole address',
    actual: textParts(`Book the offsite venue ${VENUE}`),
    expected: ['Book the offsite venue', venue],
  })

  assert({
    given: 'an address in the middle of a sentence',
    should: 'keep the words on both sides in order',
    actual: textParts(`Read ${DOC} before the call`),
    expected: ['Read', doc, 'before the call'],
  })

  assert({
    given: 'a titled Markdown link to the web',
    should: 'keep the title among the words',
    actual: textParts(`Review [the launch plan](${DOC}) today`),
    expected: ['Review the launch plan', doc, 'today'],
  })

  assert({
    given: 'a Markdown link whose title is the address itself',
    should: 'treat it as a bare address',
    actual: textParts(`Reply to Jane Doe on Atlas - [${MESSAGE}](${MESSAGE})`),
    expected: ['Reply to Jane Doe on Atlas', slack],
  })

  assert({
    given: 'two addresses',
    should: 'name each one',
    actual: textParts(`Compare ${DOC} - ${VENUE}`),
    expected: ['Compare', doc, venue],
  })

  assert({
    given: 'an address in brackets that ends the sentence',
    should: 'drop the brackets and the full stop',
    actual: [textParts(`Check the venue (${VENUE}).`), textParts(`Reply: ${MESSAGE}.`)],
    expected: [
      ['Check the venue', venue],
      ['Reply', slack],
    ],
  })

  assert({
    given: 'an address that opens the item',
    should: 'drop the dash that follows it',
    actual: [textParts(`${MESSAGE} - reply before Friday`), textParts(MESSAGE)],
    expected: [[slack, 'reply before Friday'], [slack]],
  })

  assert({
    given: 'a hyphenated word before the address',
    should: 'keep the word whole',
    actual: textParts(`Schedule the follow-up ${MESSAGE}`),
    expected: ['Schedule the follow-up', slack],
  })

  assert({
    given: 'a notebook link beside a web address',
    should: 'read the notebook link by its title',
    actual: textParts(`Read [Plan](notes/Plan.md) then ${VENUE}`),
    expected: ['Read Plan then', venue],
  })
})

test('webLink()', () => {
  const label = (href: string) => webLink(href).label

  assert({
    given: 'addresses on sites Sky names',
    should: 'say what the link is in words',
    actual: [
      label('https://example.slack.com/archives/C0000000000'),
      label('https://docs.google.com/spreadsheets/d/abc123/edit'),
      label('https://docs.google.com/presentation/d/abc123/edit'),
      label('https://docs.google.com/forms/d/abc123'),
      label('https://github.com/example/widget-v2/pull/42'),
      label('https://github.com/example/widget-v2'),
      label('https://us02web.zoom.us/j/1234567890'),
    ],
    expected: ['Slack', 'Google Sheet', 'Google Slides', 'Google Docs', 'widget-v2 #42', 'GitHub', 'Zoom'],
  })

  assert({
    given: 'any other address',
    should: 'name its host',
    actual: [label('https://www.example.com/a/b?c=d'), label('http://Sub.Example.org'), label('https://')],
    expected: ['example.com', 'sub.example.org', 'https://'],
  })

  assert({
    given: 'a host that only ends like a named site',
    should: 'not borrow its name',
    actual: [webLink('https://notslack.com/archives/C1/p1').site, label('https://mygithub.com/a/b/pull/1')],
    expected: ['web', 'mygithub.com'],
  })
})

test('itemDocLinked()', () => {
  assert({
    given: 'items that link to the web, to the notebook, to a workstream, and to nothing',
    should: 'give the whole row only to a notebook or workstream link',
    actual: [
      itemDocLinked({ link: { path: MESSAGE } }),
      itemDocLinked({ link: { path: 'actions/notes/Plan.md' } }),
      itemDocLinked({ link: { path: '/workstreams/atlas' }, workstream: { id: 'atlas' } }),
      itemDocLinked({ link: null }),
    ],
    expected: [false, true, true, false],
  })
})
