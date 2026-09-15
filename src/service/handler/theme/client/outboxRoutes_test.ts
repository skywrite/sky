import { assert, test } from '#test'
import { outboxHref, outboxItemOf, outboxLegacyItemPath } from './outboxRoutes.ts'

test({ name: 'outbox routes - the list, one item, and every other page' }, () => {
  assert({
    given: 'the list path, a readable id, a hash id, the data prefix, and other pages',
    should: 'name the list as empty, the item by its id, and nothing for the rest',
    actual: [
      outboxItemOf('/outbox'),
      outboxItemOf('/outbox/2026-09-12_1705_Approve-the-Atlas-pilot-budget'),
      outboxItemOf('/outbox/0123456789abcdef0123456789abcdef'),
      outboxItemOf('/outbox/_api'),
      outboxItemOf('/outbox/a/b'),
      outboxItemOf('/week'),
    ],
    expected: [
      '',
      '2026-09-12_1705_Approve-the-Atlas-pilot-budget',
      '0123456789abcdef0123456789abcdef',
      null,
      null,
      null,
    ],
  })
  assert({
    given: 'an id with a character the path must encode',
    should: 'write the page path the route reads back',
    actual: outboxItemOf(outboxHref('2026-09-12_1705_Q3 plan')),
    expected: '2026-09-12_1705_Q3 plan',
  })
  assert({
    given: 'no id',
    should: 'point at the list',
    actual: outboxHref(),
    expected: '/outbox',
  })
})

test({ name: 'outbox routes - the retired query link still opens its item' }, () => {
  assert({
    given: 'the old ?item= link, the same query on another page, and the list without one',
    should: 'turn only the old link into the item page path',
    actual: [
      outboxLegacyItemPath('/outbox', '?item=2026-09-12_1705_Approve-the-Atlas-pilot-budget'),
      outboxLegacyItemPath('/week', '?item=abc'),
      outboxLegacyItemPath('/outbox', ''),
    ],
    expected: ['/outbox/2026-09-12_1705_Approve-the-Atlas-pilot-budget', null, null],
  })
})
